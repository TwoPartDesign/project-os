#!/usr/bin/env bash
# scripts/lib/json.sh - Shared JSON utilities for Project OS scripts.
# Source this file: source "$(dirname "${BASH_SOURCE[0]}")/lib/json.sh"

json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}
