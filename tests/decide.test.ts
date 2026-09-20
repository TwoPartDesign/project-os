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
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  readJevConfig,
  heuristicBackend,
  decide,
  defaultLogger,
  DEFAULT_JEV_CONFIG,
  JEV_ENDPOINT,
  collectOutboundFields,
  rebuildFromFields,
  type QuestionMap,
} from "../scripts/lib/decide.ts";
import { getProjectRoot } from "../scripts/lib/project-root.ts";

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

// ============================================================================
// Jev network backend (T185)
// ============================================================================

/** The three-question fixture used by every Jev-backend test below. */
const threeQuestions: QuestionMap = {
  is_urgent: {
    type: "noul",
    instructions: "Is this urgent?",
    criteria: { true: "Yes", false: "No" },
  },
  department: {
    type: "choice",
    instructions: "Which department?",
    criteria: { billing: "Billing", technical: "Technical", sales: "Sales" },
  },
  frustration: {
    type: "score",
    instructions: "Rate frustration",
    criteria: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
  },
};

/** The documented happy-path Jev response for `threeQuestions`. */
const happyDoc = {
  answers: {
    is_urgent: { type: "noul", noul: 0.92 },
    department: {
      type: "choice",
      choice: "technical",
      probabilities: { billing: 0.1, technical: 0.85, sales: 0.05 },
      confidence: 0.85,
    },
    frustration: {
      type: "score",
      score: 1.6,
      probabilities: { "0": 0.1, "1": 0.4, "2": 0.4, "3": 0.1 },
      confidence: 0.7,
    },
  },
  usage: { input_tokens: 312, output_tokens: 48 },
};

/** Creates a fresh egress-scrub directory inside the project root. Caller must rmSync it in a finally. */
function freshEgressDir(): string {
  return mkdtempSync(resolve(getProjectRoot(), ".claude/logs", "jev-test-"));
}

describe("decide (Jev backend)", () => {
  it("decide_happyPath_returnsJevAnswersAndUsage", async () => {
    const egressDir = freshEgressDir();
    try {
      const fetchImpl = (async () =>
        new Response(JSON.stringify(happyDoc), {
          status: 200,
        })) as typeof fetch;

      const result = await decide("some state", threeQuestions, {
        config: { ...DEFAULT_JEV_CONFIG, enabled: true },
        env: { TYPESAFE_API_KEY: "k" },
        fetchImpl,
        scrubCmd: () => ({ status: 0 }),
        scanCmd: () => ({ status: 0 }),
        egressDir,
        log: () => {},
      });

      strictEqual((result.answers.is_urgent as { noul: number }).noul, 0.92);
      strictEqual(
        (result.answers.department as { choice: string }).choice,
        "technical",
      );
      strictEqual((result.answers.frustration as { score: number }).score, 1.6);
      strictEqual(result.backend, "jev");
      strictEqual(result.usage?.input_tokens, 312);
      strictEqual(result.declined, undefined);
    } finally {
      rmSync(egressDir, { recursive: true, force: true });
    }
  });

  it("decide_requestShape_matchesContract", async () => {
    const egressDir = freshEgressDir();
    try {
      let capturedUrl: string | URL | undefined;
      let capturedInit: RequestInit | undefined;
      const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return new Response(JSON.stringify(happyDoc), { status: 200 });
      }) as typeof fetch;

      await decide("some state", threeQuestions, {
        config: { ...DEFAULT_JEV_CONFIG, enabled: true },
        env: { TYPESAFE_API_KEY: "k" },
        fetchImpl,
        scrubCmd: () => ({ status: 0 }),
        scanCmd: () => ({ status: 0 }),
        egressDir,
        log: () => {},
      });

      strictEqual(capturedUrl, JEV_ENDPOINT);
      strictEqual(capturedInit?.method, "POST");
      strictEqual(capturedInit?.redirect, "manual");
      ok(capturedInit?.signal instanceof AbortSignal);
      strictEqual(
        (capturedInit?.headers as Record<string, string>).Authorization,
        "Bearer k",
      );
      const parsedBody = JSON.parse(capturedInit?.body as string);
      deepStrictEqual(Object.keys(parsedBody).sort(), [
        "model",
        "questions",
        "state",
      ]);
      strictEqual(parsedBody.model, "jev-latest");
    } finally {
      rmSync(egressDir, { recursive: true, force: true });
    }
  });

  it("decide_networkError_returnsHeuristicIdentically", async () => {
    const egressDir = freshEgressDir();
    try {
      const logs: Array<{ event: string; kv: Record<string, string> }> = [];
      const fetchImpl = (async () => {
        throw new Error("boom k");
      }) as typeof fetch;

      const result = await decide("some state", threeQuestions, {
        config: { ...DEFAULT_JEV_CONFIG, enabled: true },
        env: { TYPESAFE_API_KEY: "k" },
        fetchImpl,
        scrubCmd: () => ({ status: 0 }),
        scanCmd: () => ({ status: 0 }),
        egressDir,
        log: (event, kv) => logs.push({ event, kv }),
      });

      deepStrictEqual(
        result.answers,
        heuristicBackend("some state", threeQuestions),
      );
      strictEqual(result.declined, "network");
      strictEqual(result.backend, "heuristic");
      ok(!JSON.stringify(result).includes("boom"));
      for (const { kv } of logs) {
        for (const v of Object.values(kv)) ok(!v.includes("boom"));
      }
    } finally {
      rmSync(egressDir, { recursive: true, force: true });
    }
  });

  it("decide_timeout_declinesTimeout", async () => {
    const egressDir = freshEgressDir();
    try {
      const fetchImpl = ((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          // AbortSignal.timeout()'s internal timer is unref'd, so it never
          // fires unless something else keeps the event loop alive long
          // enough for it to run; this interval is that keep-alive.
          const keepAlive = setInterval(() => {}, 5);
          init?.signal?.addEventListener("abort", () => {
            clearInterval(keepAlive);
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      }) as typeof fetch;

      const result = await decide("some state", threeQuestions, {
        config: { ...DEFAULT_JEV_CONFIG, enabled: true, timeout_ms: 10 },
        env: { TYPESAFE_API_KEY: "k" },
        fetchImpl,
        scrubCmd: () => ({ status: 0 }),
        scanCmd: () => ({ status: 0 }),
        egressDir,
        log: () => {},
      });

      strictEqual(result.declined, "timeout");
      ok(result.duration_ms < 1000);
    } finally {
      rmSync(egressDir, { recursive: true, force: true });
    }
  });

  it("decide_redirect_declinesAndDoesNotFollow", async () => {
    const egressDir = freshEgressDir();
    try {
      let calls = 0;
      const fetchImpl = (async () => {
        calls++;
        return new Response(null, {
          status: 302,
          headers: { Location: "https://evil.example/" },
        });
      }) as typeof fetch;

      const result = await decide("some state", threeQuestions, {
        config: { ...DEFAULT_JEV_CONFIG, enabled: true },
        env: { TYPESAFE_API_KEY: "k" },
        fetchImpl,
        scrubCmd: () => ({ status: 0 }),
        scanCmd: () => ({ status: 0 }),
        egressDir,
        log: () => {},
      });

      strictEqual(result.declined, "redirect");
      strictEqual(calls, 1);
    } finally {
      rmSync(egressDir, { recursive: true, force: true });
    }
  });

  it("decide_http429_declinesHttp429", async () => {
    const egressDir = freshEgressDir();
    try {
      const fetchImpl = (async () =>
        new Response("rate limited", { status: 429 })) as typeof fetch;

      const result = await decide("some state", threeQuestions, {
        config: { ...DEFAULT_JEV_CONFIG, enabled: true },
        env: { TYPESAFE_API_KEY: "k" },
        fetchImpl,
        scrubCmd: () => ({ status: 0 }),
        scanCmd: () => ({ status: 0 }),
        egressDir,
        log: () => {},
      });

      strictEqual(result.declined, "http-429");
    } finally {
      rmSync(egressDir, { recursive: true, force: true });
    }
  });

  it("decide_http529_declinesHttp529", async () => {
    const egressDir = freshEgressDir();
    try {
      const fetchImpl = (async () =>
        new Response("overloaded", { status: 529 })) as typeof fetch;

      const result = await decide("some state", threeQuestions, {
        config: { ...DEFAULT_JEV_CONFIG, enabled: true },
        env: { TYPESAFE_API_KEY: "k" },
        fetchImpl,
        scrubCmd: () => ({ status: 0 }),
        scanCmd: () => ({ status: 0 }),
        egressDir,
        log: () => {},
      });

      strictEqual(result.declined, "http-529");
    } finally {
      rmSync(egressDir, { recursive: true, force: true });
    }
  });

  it("decide_malformedChoice_keepsHeuristicForThatQuestion", async () => {
    const egressDir = freshEgressDir();
    try {
      const badDoc = {
        answers: {
          is_urgent: { type: "noul", noul: 0.92 },
          department: {
            type: "choice",
            choice: "nope",
            probabilities: { billing: 0.1, technical: 0.85, sales: 0.05 },
            confidence: 0.85,
          },
          frustration: {
            type: "score",
            score: 1.6,
            probabilities: { "0": 0.1, "1": 0.4, "2": 0.4, "3": 0.1 },
            confidence: 0.7,
          },
        },
        usage: { input_tokens: 312, output_tokens: 48 },
      };
      const fetchImpl = (async () =>
        new Response(JSON.stringify(badDoc), { status: 200 })) as typeof fetch;

      const result = await decide("some state", threeQuestions, {
        config: { ...DEFAULT_JEV_CONFIG, enabled: true },
        env: { TYPESAFE_API_KEY: "k" },
        fetchImpl,
        scrubCmd: () => ({ status: 0 }),
        scanCmd: () => ({ status: 0 }),
        egressDir,
        log: () => {},
      });

      const heuristic = heuristicBackend("some state", threeQuestions);
      deepStrictEqual(result.answers.department, heuristic.department);
      strictEqual((result.answers.is_urgent as { noul: number }).noul, 0.92);
      strictEqual(result.declined, "malformed-response");
      strictEqual(result.backend, "jev");
    } finally {
      rmSync(egressDir, { recursive: true, force: true });
    }
  });

  it("decide_probabilityOutOfRange_rejected", async () => {
    const egressDir = freshEgressDir();
    try {
      const badDoc = {
        answers: {
          is_urgent: { type: "noul", noul: 1.4 },
          department: {
            type: "choice",
            choice: "technical",
            probabilities: { billing: 0.1, technical: 0.85, sales: 0.05 },
            confidence: 0.85,
          },
          frustration: {
            type: "score",
            score: 1.6,
            probabilities: { "0": 0.1, "1": 0.4, "2": 0.4, "3": 0.1 },
            confidence: 0.7,
          },
        },
        usage: { input_tokens: 312, output_tokens: 48 },
      };
      const fetchImpl = (async () =>
        new Response(JSON.stringify(badDoc), { status: 200 })) as typeof fetch;

      const result = await decide("some state", threeQuestions, {
        config: { ...DEFAULT_JEV_CONFIG, enabled: true },
        env: { TYPESAFE_API_KEY: "k" },
        fetchImpl,
        scrubCmd: () => ({ status: 0 }),
        scanCmd: () => ({ status: 0 }),
        egressDir,
        log: () => {},
      });

      const heuristic = heuristicBackend("some state", threeQuestions);
      deepStrictEqual(result.answers.is_urgent, heuristic.is_urgent);
    } finally {
      rmSync(egressDir, { recursive: true, force: true });
    }
  });

  it("decide_guardRefused_declinesWithGuardReason", async () => {
    const egressDir = freshEgressDir();
    try {
      let calls = 0;
      const fetchImpl = (async () => {
        calls++;
        return new Response(JSON.stringify(happyDoc), { status: 200 });
      }) as typeof fetch;

      const result = await decide("some state", threeQuestions, {
        config: { ...DEFAULT_JEV_CONFIG, enabled: true },
        env: { TYPESAFE_API_KEY: "k" },
        fetchImpl,
        scrubCmd: () => ({ status: 0 }),
        scanCmd: () => ({ status: 1 }),
        egressDir,
        log: () => {},
      });

      strictEqual(result.declined, "scrub-failed");
      strictEqual(calls, 0);
    } finally {
      rmSync(egressDir, { recursive: true, force: true });
    }
  });

  it("decide_egressDirSymlinkOutsideRoot_declinesEgressDirUnsafe", async () => {
    const projectRoot = getProjectRoot();
    const outsideDir = mkdtempSync(resolve(tmpdir(), "decide-outside-"));
    const linkPath = resolve(
      projectRoot,
      ".claude/logs",
      `jev-symlink-test-${process.pid}-${Date.now()}`,
    );
    try {
      symlinkSync(outsideDir, linkPath, "dir");
      let calls = 0;
      const fetchImpl = (async () => {
        calls++;
        return new Response(JSON.stringify(happyDoc), { status: 200 });
      }) as typeof fetch;

      const result = await decide("some state", threeQuestions, {
        config: { ...DEFAULT_JEV_CONFIG, enabled: true },
        env: { TYPESAFE_API_KEY: "k" },
        fetchImpl,
        scrubCmd: () => ({ status: 0 }),
        scanCmd: () => ({ status: 0 }),
        egressDir: linkPath,
        log: () => {},
      });

      strictEqual(result.declined, "egress-dir-unsafe");
      strictEqual(calls, 0);
    } finally {
      rmSync(linkPath, { force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("decide_bodyBuiltFromGuardedFields", async () => {
    const egressDir = freshEgressDir();
    try {
      const secretValue = "abcdefghij1234567890";
      const state = "privateKey=" + secretValue;
      let capturedInit: RequestInit | undefined;
      const fetchImpl = (async (_url: string, init?: RequestInit) => {
        capturedInit = init;
        return new Response(JSON.stringify(happyDoc), { status: 200 });
      }) as typeof fetch;

      const result = await decide(state, threeQuestions, {
        config: { ...DEFAULT_JEV_CONFIG, enabled: true },
        env: { TYPESAFE_API_KEY: "k" },
        fetchImpl,
        scrubCmd: () => ({ status: 0 }),
        scanCmd: () => ({ status: 0 }),
        egressDir,
        log: () => {},
      });

      const body = capturedInit?.body as string;
      ok(body.includes("[REDACTED:key]"));
      ok(!body.includes(secretValue));
      strictEqual(result.redactions, 1);
    } finally {
      rmSync(egressDir, { recursive: true, force: true });
    }
  });

  it("decide_oversizedBody_declinesTooLarge", async () => {
    const egressDir = freshEgressDir();
    try {
      let calls = 0;
      const fetchImpl = (async () => {
        calls++;
        return new Response(JSON.stringify(happyDoc), { status: 200 });
      }) as typeof fetch;
      const bigState = "x".repeat(100);

      const result = await decide(bigState, threeQuestions, {
        config: { ...DEFAULT_JEV_CONFIG, enabled: true, max_body_tokens: 10 },
        env: { TYPESAFE_API_KEY: "k" },
        fetchImpl,
        scrubCmd: () => ({ status: 0 }),
        scanCmd: () => ({ status: 0 }),
        egressDir,
        log: () => {},
      });

      strictEqual(result.declined, "too-large");
      strictEqual(calls, 0);
    } finally {
      rmSync(egressDir, { recursive: true, force: true });
    }
  });

  it("decide_keyNeverInBodyLogsOrResult", async () => {
    const egressDir = freshEgressDir();
    try {
      const keyPart1 = "SECRET";
      const keyPart2 = "KEY123";
      const key = keyPart1 + keyPart2;
      const logs: Array<{ event: string; kv: Record<string, string> }> = [];
      let capturedInit: RequestInit | undefined;

      const fetchImplHappy = (async (_url: string, init?: RequestInit) => {
        capturedInit = init;
        return new Response(JSON.stringify(happyDoc), { status: 200 });
      }) as typeof fetch;
      const resultHappy = await decide("some state", threeQuestions, {
        config: { ...DEFAULT_JEV_CONFIG, enabled: true },
        env: { TYPESAFE_API_KEY: key },
        fetchImpl: fetchImplHappy,
        scrubCmd: () => ({ status: 0 }),
        scanCmd: () => ({ status: 0 }),
        egressDir,
        log: (event, kv) => logs.push({ event, kv }),
      });

      strictEqual(
        (capturedInit?.headers as Record<string, string>).Authorization,
        "Bearer " + key,
      );
      ok(!(capturedInit?.body as string).includes(key));
      ok(!JSON.stringify(resultHappy).includes(key));

      const fetchImplErr = (async () => {
        throw new Error("network fail " + key);
      }) as typeof fetch;
      const resultErr = await decide("some state", threeQuestions, {
        config: { ...DEFAULT_JEV_CONFIG, enabled: true },
        env: { TYPESAFE_API_KEY: key },
        fetchImpl: fetchImplErr,
        scrubCmd: () => ({ status: 0 }),
        scanCmd: () => ({ status: 0 }),
        egressDir,
        log: (event, kv) => logs.push({ event, kv }),
      });
      ok(!JSON.stringify(resultErr).includes(key));

      for (const { kv } of logs) {
        for (const v of Object.values(kv)) ok(!v.includes(key));
      }
    } finally {
      rmSync(egressDir, { recursive: true, force: true });
    }
  });

  it("decide_logsQueriedEventWithMetadata", async () => {
    const egressDir = freshEgressDir();
    try {
      const logs: Array<{ event: string; kv: Record<string, string> }> = [];
      const fetchImpl = (async () =>
        new Response(JSON.stringify(happyDoc), {
          status: 200,
        })) as typeof fetch;

      await decide("some state", threeQuestions, {
        config: { ...DEFAULT_JEV_CONFIG, enabled: true },
        env: { TYPESAFE_API_KEY: "k" },
        fetchImpl,
        scrubCmd: () => ({ status: 0 }),
        scanCmd: () => ({ status: 0 }),
        egressDir,
        consumer: "test",
        log: (event, kv) => logs.push({ event, kv }),
      });

      const queried = logs.filter((l) => l.event === "jev-queried");
      strictEqual(queried.length, 1);
      strictEqual(queried[0].kv.questions, "3");
      strictEqual(queried[0].kv.backend, "jev");
      strictEqual(queried[0].kv.input_tokens, "312");
      strictEqual(queried[0].kv.threshold_out_of_scope_p, "0.8");
      strictEqual(queried[0].kv.consumer, "test");
    } finally {
      rmSync(egressDir, { recursive: true, force: true });
    }
  });
});

describe("egress allowlist", () => {
  it("egressAllowlist_containsEndpointHostAndCaller", () => {
    const projectRoot = getProjectRoot();
    const allowlistPath = resolve(
      projectRoot,
      ".claude/security/egress-allowlist.json",
    );
    const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));
    const host = new URL(JEV_ENDPOINT).host;
    strictEqual(
      allowlist.approved_egress[host].caller,
      "scripts/lib/decide.ts",
    );
    strictEqual(allowlist.approved_egress[host].endpoint, JEV_ENDPOINT);
  });
});

describe("collectOutboundFields / rebuildFromFields", () => {
  it("collectOutboundFields_order_isStable", () => {
    const state = "some state";
    const fields = collectOutboundFields(state, threeQuestions);
    deepStrictEqual(fields, [
      "some state",
      "Is this urgent?",
      "Yes",
      "No",
      "Which department?",
      "Billing",
      "Technical",
      "Sales",
      "Rate frustration",
      "LOW",
      "MEDIUM",
      "HIGH",
      "CRITICAL",
    ]);
    deepStrictEqual(rebuildFromFields(fields, threeQuestions), {
      state,
      questions: threeQuestions,
    });
  });
});
