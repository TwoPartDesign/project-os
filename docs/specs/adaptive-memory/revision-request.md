---
feature: adaptive-memory
date: 2026-03-25
type: revision-request
---

# Revision Request: adaptive-memory

## Required Fixes (MUST)

### T7: Persist observations to observation_meta DB
**File**: `.claude/hooks/output-index.sh`
**Issue**: Observations are extracted by the parser but never written to the DB.
**Fix**: After the observation extraction block (line ~91), add:
```bash
if [ -n "$OBS_FILE" ] && [ -f "$OBS_FILE" ]; then
    node "$INDEX_SCRIPT" index-observations "$TEMP_FILE" "$OBS_FILE" 2>/dev/null || true
fi
```

### T8: Add --obs-type search filter to cmdSearch
**File**: `scripts/knowledge-index.ts`
**Issue**: `cmdSearch` has no `--obs-type` flag and no JOIN to `observation_meta`.
**Fix**:
1. Add `let observationType: string | null = null;` to the options section
2. Parse `--obs-type` / `--observation-type` flags
3. When observationType is set, add `INNER JOIN observation_meta om ON k.source = om.source AND k.heading = om.heading` and `AND om.observation_type = ?` to the SQL
4. Include observationType in the parameter binding array
5. Display `[TYPE]` prefix in result output when filtering

## Recommended Fixes (SHOULD)

### pre-compact.sh: YAML quoting
Wrap `$FEATURE` and `$fpath` in YAML double-quotes and escape internal double-quotes.

### output-index.sh: Fix trap cleanup
Use a cleanup function instead of literal trap to capture `OBS_FILE` by reference.

### settings.json: Add recency_halflife_days
Add `"recency_halflife_days": 14` to `project_os.context_filter.freshness` block.

### observation-parser.ts: Sensitive key denylist
Add a `SENSITIVE_KEY_PATTERNS` array (API_KEY, SECRET, TOKEN, PASSWORD, CREDENTIAL) and skip matching config keys whose names contain these patterns.
