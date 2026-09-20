import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const applicationPath = process.env.PLAYWRIGHT_BASE_PATH ?? "/";
const inlineProbe = "window.__wandererInjected = true";
const inlineProbeHash =
  "sha256-" + createHash("sha256").update(inlineProbe).digest("base64");

const captureDiagnostics = (page: Page) => {
  const unexpected: string[] = [];
  let probing = false;
  let expectedBlocks = 0;
  page.on("pageerror", (error) =>
    unexpected.push("pageerror: " + error.message),
  );
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (
      probing &&
      expectedBlocks === 0 &&
      text.includes("Executing inline script") &&
      text.includes("script-src 'self'") &&
      text.includes(inlineProbeHash)
    ) {
      expectedBlocks += 1;
    } else unexpected.push("console: " + text);
  });
  page.on("requestfailed", (request) =>
    unexpected.push("requestfailed: " + request.url()),
  );
  page.on("response", (response) => {
    if (response.status() >= 400)
      unexpected.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  return {
    unexpected,
    expectInlineProbe: () => {
      probing = true;
    },
    finishInlineProbe: () => {
      probing = false;
    },
    expectedBlocks: () => expectedBlocks,
  };
};
const requireCleanDiagnostics = (errors: readonly string[]) =>
  expect(errors, "Unexpected browser diagnostics").toEqual([]);

test("production meta CSP supports rendering/storage and blocks an injected inline script", async ({
  page,
}) => {
  const diagnostics = captureDiagnostics(page);
  await page.goto(applicationPath, { waitUntil: "commit" });
  await expect(
    page.locator('meta[http-equiv="Content-Security-Policy"]'),
  ).toHaveAttribute("content", /script-src 'self'/);
  await expect(page.getByTestId("world-canvas")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const key = "__wanderer_csp_probe";
        localStorage.setItem(key, "ok");
        const value = localStorage.getItem(key);
        localStorage.removeItem(key);
        return value === "ok";
      }),
    )
    .toBe(true);

  diagnostics.expectInlineProbe();
  const blocked = await page.evaluate(
    (probe) =>
      new Promise<boolean>((resolve) => {
        window.addEventListener(
          "securitypolicyviolation",
          (event) =>
            resolve(
              event.violatedDirective === "script-src-elem" ||
                event.violatedDirective === "script-src",
            ),
          { once: true },
        );
        const script = document.createElement("script");
        script.textContent = probe;
        document.body.append(script);
        setTimeout(() => resolve(false), 1_000);
      }),
    inlineProbe,
  );
  expect(blocked).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __wandererInjected?: boolean })
            .__wandererInjected ?? false,
      ),
    )
    .toBe(false);
  await expect.poll(diagnostics.expectedBlocks).toBe(1);
  diagnostics.finishInlineProbe();
  requireCleanDiagnostics(diagnostics.unexpected);
});

test("browser diagnostics rejects synthetic page, console and network errors", async ({
  page,
}) => {
  const diagnostics = captureDiagnostics(page);
  await page.route("**/__diagnostic_http__", (route) =>
    route.fulfill({
      status: 500,
      contentType: "text/html",
      body: "Synthetic diagnostic fixture",
    }),
  );
  await page.goto(applicationPath + "__diagnostic_http__");
  await expect
    .poll(() =>
      diagnostics.unexpected.some((value) => value.startsWith("HTTP 500:")),
    )
    .toBe(true);
  await page.evaluate(() => {
    console.error("WANDERER_SYNTHETIC_CONSOLE_ERROR");
    setTimeout(() => {
      throw new Error("WANDERER_SYNTHETIC_PAGE_ERROR");
    }, 0);
  });
  await expect
    .poll(() => diagnostics.unexpected)
    .toContain("console: WANDERER_SYNTHETIC_CONSOLE_ERROR");
  await expect
    .poll(() => diagnostics.unexpected)
    .toContain("pageerror: WANDERER_SYNTHETIC_PAGE_ERROR");
  await page.route("**/__diagnostic_failure__", (route) =>
    route.abort("failed"),
  );
  await page.evaluate(async (path) => {
    await fetch(path).catch(() => undefined);
  }, applicationPath + "__diagnostic_failure__");
  await expect
    .poll(() =>
      diagnostics.unexpected.some((value) =>
        value.startsWith("requestfailed:"),
      ),
    )
    .toBe(true);
  expect(() => requireCleanDiagnostics(diagnostics.unexpected)).toThrow(
    "Unexpected browser diagnostics",
  );
});
