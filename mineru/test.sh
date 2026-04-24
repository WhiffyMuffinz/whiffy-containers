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

echo "Waiting for API to start (with retry)..."

# Wait for API with retry logic
MAX_RETRIES=30
RETRY_INTERVAL=1
MAX_RETRY_INTERVAL=10
API_READY=false

for ((i = 1; i <= MAX_RETRIES; i++)); do
  # Check if process is still running
  if ! kill -0 $API_PID 2>/dev/null; then
    fail "mineru-api process died unexpectedly"
    exit 1
  fi

  # Try to connect to the API
  if curl -sf http://127.0.0.1:8765/openapi.json >/dev/null 2>&1; then
    API_READY=true
    break
  fi

  echo "  Attempt $i/$MAX_RETRIES: API not ready yet, waiting ${RETRY_INTERVAL}s..."
  sleep $RETRY_INTERVAL

  # Exponential backoff with cap
  RETRY_INTERVAL=$((RETRY_INTERVAL * 2))
  if [ $RETRY_INTERVAL -gt $MAX_RETRY_INTERVAL ]; then
    RETRY_INTERVAL=$MAX_RETRY_INTERVAL
  fi
done

if [ "$API_READY" = true ]; then
  pass "mineru-api started and /openapi.json endpoint is responsive"
else
  fail "mineru-api failed to become ready within timeout"
  exit 1
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
