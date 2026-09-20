// tests/decide.test.ts
// Unit tests for scripts/lib/decide.ts (Jev decision interface: types,
// config, heuristic backend, decide() skeleton). Each test builds its own
// fixture (temp settings file or inline deps) — no shared mutable state, no
// shared beforeEach. Run in isolation with:
//   node --test tests/decide.test.ts

import { describe, it } from "node:test";
import {
  deepStrictEqual,
  strictEqual,
  ok,
  doesNotThrow,
} from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  readJevConfig,
  heuristicBackend,
  decide,
  defaultLogger,
  DEFAULT_JEV_CONFIG,
  type QuestionMap,
} from "../scripts/lib/decide.ts";

/** Creates a fresh, isolated temp directory for one test. Caller must rmSync it in a finally. */
function freshTempDir(): string {
  return mkdtempSync(resolve(tmpdir(), "decide-test-"));
}

/** Writes `content` (an object, JSON-stringified) to `<dir>/settings.json` and returns its path. */
function writeSettings(dir: string, content: unknown): string {
  const path = resolve(dir, "settings.json");
  writeFileSync(path, JSON.stringify(content), "utf8");
  return path;
}

describe("readJevConfig", () => {
  it("readJevConfig_missingFile_returnsDefaults", () => {
    const dir = freshTempDir();
    try {
      const path = resolve(dir, "does-not-exist.json");
      deepStrictEqual(readJevConfig(path), DEFAULT_JEV_CONFIG);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("readJevConfig_partialBlock_mergesDefaults", () => {
    const dir = freshTempDir();
    try {
      const path = writeSettings(dir, {
        project_os: { jev: { timeout_ms: 250 } },
      });
      const result = readJevConfig(path);
      strictEqual(result.timeout_ms, 250);
      strictEqual(result.enabled, false);
      strictEqual(result.thresholds.duplicate_p, 0.85);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("readJevConfig_enabledNotBoolean_treatedAsFalse", () => {
    const dir = freshTempDir();
    try {
      const path = writeSettings(dir, {
        project_os: { jev: { enabled: "true" } },
      });
      strictEqual(readJevConfig(path).enabled, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("readJevConfig_thresholdOutOfRange_fallsBack", () => {
    const dir = freshTempDir();
    try {
      const path = writeSettings(dir, {
        project_os: { jev: { thresholds: { duplicate_p: 1.7 } } },
      });
      strictEqual(readJevConfig(path).thresholds.duplicate_p, 0.85);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("heuristicBackend", () => {
  it("heuristicBackend_noul_returnsHalf", () => {
    const questions: QuestionMap = {
      q1: { type: "noul", instructions: "is it true?" },
    };
    const result = heuristicBackend("some state", questions);
    deepStrictEqual(result.q1, { type: "noul", noul: 0.5 });
  });

  it("heuristicBackend_choice_returnsFirstKeyUniform", () => {
    const questions: QuestionMap = {
      q1: {
        type: "choice",
        instructions: "pick one",
        criteria: { a: "A", b: "B", c: "C" },
      },
    };
    const result = heuristicBackend("some state", questions);
    const answer = result.q1 as {
      type: "choice";
      choice: string;
      probabilities: Record<string, number>;
      confidence: number;
    };
    strictEqual(answer.choice, "a");
    ok(Math.abs(answer.probabilities.b - 1 / 3) < 1e-9);
    strictEqual(answer.confidence, 0);
  });

  it("heuristicBackend_scoreFourLevels_returnsIndexOne", () => {
    const questions: QuestionMap = {
      q1: {
        type: "score",
        instructions: "rate it",
        criteria: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      },
    };
    const result = heuristicBackend("some state", questions);
    const answer = result.q1 as { type: "score"; score: number };
    strictEqual(answer.score, 1);
  });
});

describe("decide", () => {
  const questions: QuestionMap = {
    q1: { type: "noul", instructions: "is it true?" },
  };
  const state = "some state";

  it("decide_disabled_returnsHeuristicIdentically", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      throw new Error("fetch should not be called");
    }) as typeof fetch;

    const result = await decide(state, questions, {
      config: { ...DEFAULT_JEV_CONFIG, enabled: false },
      env: { TYPESAFE_API_KEY: "k" },
      fetchImpl,
      log: () => {},
    });

    deepStrictEqual(result.answers, heuristicBackend(state, questions));
    strictEqual(result.backend, "heuristic");
    strictEqual(result.declined, "disabled");
    strictEqual(calls, 0);
  });

  it("decide_noKey_returnsHeuristicIdentically", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      throw new Error("fetch should not be called");
    }) as typeof fetch;

    const result = await decide(state, questions, {
      config: { ...DEFAULT_JEV_CONFIG, enabled: true },
      env: {},
      fetchImpl,
      log: () => {},
    });

    deepStrictEqual(result.answers, heuristicBackend(state, questions));
    strictEqual(result.backend, "heuristic");
    strictEqual(result.declined, "no-key");
    strictEqual(calls, 0);
  });

  it("decide_logsDeclinedEventWithReasonAndThresholds", async () => {
    const calls: Array<{ event: string; kv: Record<string, string> }> = [];
    const log = (event: string, kv: Record<string, string>) => {
      calls.push({ event, kv });
    };

    await decide(state, questions, {
      config: { ...DEFAULT_JEV_CONFIG, enabled: true },
      env: {},
      consumer: "test",
      log,
    });

    strictEqual(calls.length, 1);
    strictEqual(calls[0].event, "jev-declined");
    strictEqual(calls[0].kv.reason, "no-key");
    strictEqual(calls[0].kv.threshold_duplicate_p, "0.85");
    strictEqual(calls[0].kv.consumer, "test");
  });
});

describe("defaultLogger", () => {
  it("defaultLogger_hookMissing_doesNotThrow", () => {
    const dir = freshTempDir();
    try {
      doesNotThrow(() => defaultLogger("x", { a: "b" }, dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
