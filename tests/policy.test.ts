// tests/policy.test.ts
// Unit tests for scripts/lib/policy.ts (shared maintenance-policy.yaml reader).
// Each test builds its own fixture file in a fresh temp dir — no shared
// mutable state, no shared beforeEach. Run in isolation with:
//   node --test tests/policy.test.ts

import { describe, it } from "node:test";
import { strictEqual } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { readPolicyValue, readPolicyNumber, readPolicyFlag } from "../scripts/lib/policy.ts";

/** Creates a fresh, isolated temp directory for one test. Caller must rmSync it in a finally. */
function freshTempDir(): string {
  return mkdtempSync(resolve(tmpdir(), "policy-test-"));
}

/** Writes `content` to `<dir>/maintenance-policy.yaml` and returns its path. */
function writeFixture(dir: string, content: string): string {
  const path = resolve(dir, "maintenance-policy.yaml");
  writeFileSync(path, content, "utf8");
  return path;
}

describe("readPolicyValue", () => {
  it("readPolicyValue_presentKey_returnsTrimmedValue", () => {
    const dir = freshTempDir();
    try {
      const path = writeFixture(dir, "skill_auto_apply: on\n");
      strictEqual(readPolicyValue("skill_auto_apply", path), "on");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("readPolicyValue_commentedOrIndentedKey_returnsNull", () => {
    const dir = freshTempDir();
    try {
      const path = writeFixture(dir, "# skill_auto_apply: on\n  skill_auto_apply: on\n");
      strictEqual(readPolicyValue("skill_auto_apply", path), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("readPolicyValue_missingFile_returnsNull", () => {
    const dir = freshTempDir();
    try {
      const path = resolve(dir, "does-not-exist.yaml");
      strictEqual(readPolicyValue("skill_auto_apply", path), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("readPolicyValue_duplicateKey_firstWins", () => {
    const dir = freshTempDir();
    try {
      const path = writeFixture(dir, "stale_threshold_days: 90\nstale_threshold_days: 30\n");
      strictEqual(readPolicyValue("stale_threshold_days", path), "90");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("readPolicyNumber", () => {
  it("readPolicyNumber_malformedValue_returnsFallback", () => {
    const dir = freshTempDir();
    try {
      const path = writeFixture(dir, "bloat_warn_tokens: banana\n");
      strictEqual(readPolicyNumber("bloat_warn_tokens", 2500, path), 2500);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("readPolicyFlag", () => {
  it("readPolicyFlag_offValue_returnsFalse", () => {
    const dir = freshTempDir();
    try {
      const path = writeFixture(dir, "skill_auto_apply: off\n");
      strictEqual(readPolicyFlag("skill_auto_apply", true, path), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
