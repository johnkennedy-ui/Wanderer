import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

export const withPrivateArchive = async ({
  cwd,
  label,
  source,
  expectedHash,
  use,
}) => {
  // The reusable cache is attacker-controlled within the stated concurrent
  // writer model. Private bytes and the executable must never live below it.
  const directory = mkdtempSync(join(tmpdir(), `wanderer-sec01-${label}-`));
  chmodSync(directory, 0o700);
  const archive = join(directory, "archive.tar.gz");
  try {
    execFileSync(
      "python3",
      [
        fileURLToPath(new URL("archive.py", import.meta.url)),
        "snapshot",
        source,
        archive,
        expectedHash,
      ],
      {
        cwd,
        encoding: "utf8",
        timeout: 300_000,
        maxBuffer: 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return await use({ archive, directory });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};
