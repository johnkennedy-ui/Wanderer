import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve("dist");
const host = "127.0.0.1";
const portArgumentIndex = process.argv.indexOf("--port");
const portArgument =
  portArgumentIndex < 0 ? undefined : process.argv[portArgumentIndex + 1];
const port = Number(process.env.PLAYWRIGHT_PORT ?? portArgument ?? "4173");
if (!Number.isInteger(port) || port < 1 || port > 65_535)
  throw new Error(`Invalid browser preview port: ${port}`);
const mimeByExtension = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const relativePathFor = (pathname) => {
  const decoded = decodeURIComponent(pathname);
  const mounted = decoded.startsWith("/Wanderer/")
    ? decoded.slice("/Wanderer/".length)
    : decoded.replace(/^\/+/, "");
  return mounted === "" ? "index.html" : mounted;
};

createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", `http://${host}`).pathname;
  const relativePath = relativePathFor(pathname);
  const candidate = normalize(join(root, relativePath));
  const insideRoot = candidate === root || candidate.startsWith(`${root}/`);
  const file =
    insideRoot && existsSync(candidate) ? candidate : join(root, "index.html");
  response.writeHead(200, {
    "content-type":
      mimeByExtension[extname(file)] ?? "application/octet-stream",
  });
  createReadStream(file).pipe(response);
})
  .listen(port, host, () => {
    process.stdout.write(`Browser preview: http://${host}:${port}/\n`);
  })
  .on("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
