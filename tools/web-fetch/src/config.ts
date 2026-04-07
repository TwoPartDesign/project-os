import { readFileSync } from "node:fs";

// ── Shared interfaces ──────────────────────────────────────────────────────────

export interface FetchResult {
  url: string;
  title: string;
  content: string;
  excerpt?: string;
  byline?: string;
  wordCount: number;
  tokenEstimate: number;
  fromCache: boolean;
  fetchTier: "cache" | "http" | "wayback";
  sanitized: string[];
}

export interface FetchOptions {
  maxTokens?: number;
  startIndex?: number;
  mode?: "readable" | "raw" | "markdown";
  noCache?: boolean;
  timeout?: number;
}

export interface CacheConfig {
  enabled: boolean;
  ttlDefault: number;
  ttlDocs: number;
  ttlNews: number;
  maxSizeMb: number;
  dir: string;
}

// ── Config interface ───────────────────────────────────────────────────────────

export interface WebFetchConfig {
  fetch: {
    timeout: number;
    retryCount: number;
    retryBaseDelay: number;
    userAgent: string;
    headlessThreshold: number;
  };
  extraction: {
    mode: "readable" | "raw" | "markdown";
    maxTokens: number;
    sanitizeInjections: boolean;
    includeMetadataHeader: boolean;
    stripImages: boolean;
  };
  cache: CacheConfig;
  rateLimit: {
    defaultRps: number;
    respectRobotsTxt: boolean;
  };
  wayback: {
    enabled: boolean;
  };
}

// ── Defaults ───────────────────────────────────────────────────────────────────

export const DEFAULT_CONFIG: WebFetchConfig = {
  fetch: {
    timeout: 15000,
    retryCount: 3,
    retryBaseDelay: 1000,
    userAgent: "ProjectOS-WebFetch/1.0",
    headlessThreshold: 500,
  },
  extraction: {
    mode: "readable",
    maxTokens: 15000,
    sanitizeInjections: true,
    includeMetadataHeader: true,
    stripImages: true,
  },
  cache: {
    enabled: true,
    ttlDefault: 21600,
    ttlDocs: 86400,
    ttlNews: 3600,
    maxSizeMb: 200,
    dir: "tools/web-fetch/.cache",
  },
  rateLimit: {
    defaultRps: 2,
    respectRobotsTxt: false,
  },
  wayback: {
    enabled: false,
  },
};

// ── Deep merge helper ──────────────────────────────────────────────────────────

function deepMerge<T extends Record<string, unknown>>(
  base: T,
  override: Partial<T>
): T {
  const result = { ...base };
  for (const key of Object.keys(override) as (keyof T)[]) {
    const baseVal = base[key];
    const overrideVal = override[key];
    if (
      overrideVal !== null &&
      typeof overrideVal === "object" &&
      !Array.isArray(overrideVal) &&
      baseVal !== null &&
      typeof baseVal === "object" &&
      !Array.isArray(baseVal)
    ) {
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overrideVal as Record<string, unknown>
      ) as T[keyof T];
    } else if (overrideVal !== undefined) {
      result[key] = overrideVal as T[keyof T];
    }
  }
  return result;
}

// ── Config loader ──────────────────────────────────────────────────────────────

/**
 * Load WebFetchConfig from an optional JSON file path.
 * If the file does not exist, returns DEFAULT_CONFIG.
 * If the file exists but contains invalid JSON, throws a clear error.
 * Fields present in the file deep-merge with defaults.
 */
export function loadConfig(configPath?: string): WebFetchConfig {
  if (!configPath) {
    return DEFAULT_CONFIG;
  }

  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch {
    // File does not exist or is unreadable — return defaults
    return DEFAULT_CONFIG;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `web-fetch: failed to parse config file "${configPath}": ${msg}`
    );
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `web-fetch: config file "${configPath}" must be a JSON object`
    );
  }

  return deepMerge(
    DEFAULT_CONFIG as unknown as Record<string, unknown>,
    parsed as Record<string, unknown>
  ) as unknown as WebFetchConfig;
}
