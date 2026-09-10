import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Boot-time env validation exits the process on a missing variable, and
    // several modules read it at import time, so the suite needs a valid
    // environment before any of them load.
    setupFiles: ["src/__tests__/setup-env.ts"],
  },
});
