import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/tests/domain/**/*.test.ts"],
    environment: "node",
  },
});
