import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../domain/", import.meta.url));
const forbidden = [
  /\bdocument\.(?:getElementById|addEventListener|querySelector|createElement)\b/,
  /\bwindow\b/,
  /localStorage/,
  /\bTHREE\b/,
  /@capacitor\//,
  /Math\.random/,
  /from\s+["'](?:\.\.\/)+(?:app|platform|ui)\//,
];

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

const failures = [];
for (const path of files(root)) {
  if (!path.endsWith(".ts")) continue;
  const source = readFileSync(path, "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(source)) failures.push(`${path}: forbidden ${pattern}`);
  }
}

const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
if (!/createGameApplication\(/.test(main) || /new GameSession/.test(main)) {
  failures.push(
    "src/main.ts must only delegate construction to createGameApplication",
  );
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  "architecture guard: PASS (pure domain and explicit composition entrypoint)",
);
