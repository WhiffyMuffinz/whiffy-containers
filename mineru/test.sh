#!/bin/bash
set -uo pipefail

PASS=0
FAIL=0

RED='\033[0;31m'
GREEN='\033[0;32m'
RESET='\033[0m'

pass() {
  PASS=$((PASS + 1))
  echo -e "  ${GREEN}✓${RESET} $1"
}

fail() {
  FAIL=$((FAIL + 1))
  echo -e "  ${RED}✗${RESET} $1"
}

echo -e "\n=== Mineru Smoke Tests ===\n"

echo "Starting mineru-api in background..."
mineru-api --host 127.0.0.1 --port 8765 &
API_PID=$!

cleanup() {
  kill $API_PID 2>/dev/null || true
}
trap cleanup EXIT

echo "Waiting for API to start..."
sleep 5

if ! kill -0 $API_PID 2>/dev/null; then
  fail "mineru-api failed to start"
else
  pass "mineru-api started"
fi

echo -e "\n[API Endpoint]"

if curl -sf http://127.0.0.1:8765/openapi.json >/dev/null; then
  pass "/openapi.json endpoint responds"
else
  fail "/openapi.json endpoint failed"
fi

echo ""
echo -e "=== Results: ${GREEN}${PASS} passed${RESET}, ${RED}${FAIL} failed${RESET} ==="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
