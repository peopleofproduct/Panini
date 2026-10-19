#!/usr/bin/env bash
# Project Panini — pre-commit quality gate.
#
# Install locally:
#   cp scripts/pre-commit.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
#
# (Or point the whole repo at a tracked hooks dir: git config core.hooksPath .githooks)

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

echo "pre-commit: checking dependency pins…"
node scripts/check-pins.mjs

echo "pre-commit: running lint…"
npm run lint

echo "pre-commit: checking formatting…"
npm run format:check

echo "pre-commit: running test suite…"
npm run test

echo "pre-commit: all checks passed."
