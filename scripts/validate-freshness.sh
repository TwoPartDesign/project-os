#!/bin/bash
# Thin wrapper for freshness validation commands
# Usage: ./scripts/validate-freshness.sh validate <source>
#        ./scripts/validate-freshness.sh validate-vault
#        ./scripts/validate-freshness.sh report

node scripts/knowledge-index.ts "$@"
