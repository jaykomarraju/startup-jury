import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "unit",
    // §8 Q32, answered by `W5-A` and applied at Wave 5 integration. Vitest's 5 s
    // default assumes a machine doing nothing else, which no machine in this
    // programme has been: at ambient load 60-90 the suite failed 30-38 tests
    // across 20+ files that the run before had passed, every one of them
    // `Test timed out in 5000ms`, and every one green when re-run alone.
    // `--no-file-parallelism` did not help, which rules out cross-file
    // interference and leaves the clock. With the budget raised and no
    // assertion touched, the same tree was 1321/1321 in 99 s at load 61.
    // This weakens nothing — a test needing 6 s on a busy box is not failing,
    // and a genuinely hung one still fails, 25 s later.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    environment: "node",
    include: ["test/unit/**/*.test.ts"],
  },
});
