import { defineConfig } from "vite";

function normalizeBasePath(configuredBasePath: string | undefined): string {
  const pathWithoutOuterSlashes = (configuredBasePath ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "");

  return pathWithoutOuterSlashes === "" ? "/" : `/${pathWithoutOuterSlashes}/`;
}

export default defineConfig({
  base: normalizeBasePath(process.env.VITE_BASE_PATH),
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
