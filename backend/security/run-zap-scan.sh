#!/bin/bash
#
# OWASP ZAP Security Scan for Artifex API
#
# Prerequisites:
#   - Docker installed and running
#   - Artifex backend running on localhost:3002
#
# Usage:
#   cd ai-gallery/backend/security
#   bash run-zap-scan.sh
#
# Reports saved to: ./reports/

set -e

API_URL="http://host.docker.internal:3002"
REPORTS_DIR="$(pwd)/reports"
mkdir -p "$REPORTS_DIR"

echo "============================================"
echo "  Artifex API — OWASP ZAP Security Scan"
echo "============================================"
echo ""

# 1. Check backend is running
echo "[1/5] Checking backend..."
if ! curl -sf "$API_URL/api/health" > /dev/null 2>&1; then
  # Try localhost for non-Docker access
  API_URL="http://localhost:3002"
  if ! curl -sf "$API_URL/api/health" > /dev/null 2>&1; then
    echo "ERROR: Artifex backend not running on port 3002"
    exit 1
  fi
fi
echo "  Backend OK at $API_URL"

# 2. Create a test user for authenticated scanning
echo "[2/5] Creating test user for scan..."
REGISTER_RESULT=$(curl -sf -X POST "$API_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"username":"zaptest","password":"ZapTest123!","display_name":"ZAP Scanner"}' 2>/dev/null || true)

# If user exists, login instead
TOKEN=$(echo "$REGISTER_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || true)
if [ -z "$TOKEN" ]; then
  LOGIN_RESULT=$(curl -sf -X POST "$API_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"zaptest","password":"ZapTest123!"}' 2>/dev/null)
  TOKEN=$(echo "$LOGIN_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || true)
fi

if [ -z "$TOKEN" ]; then
  echo "  WARNING: Could not get auth token — scan will run unauthenticated"
  AUTH_HEADER=""
else
  echo "  Got auth token for authenticated scanning"
  AUTH_HEADER="-z \"replacer.full_list(0).description=auth\" -z \"replacer.full_list(0).enabled=true\" -z \"replacer.full_list(0).matchtype=REQ_HEADER\" -z \"replacer.full_list(0).matchstr=Authorization\" -z \"replacer.full_list(0).replacement=Bearer $TOKEN\""
fi

# 3. Run ZAP API scan
echo "[3/5] Running ZAP API scan (this may take 5-15 minutes)..."
echo "  Importing OpenAPI spec from $API_URL/api/docs/spec.json"
echo ""

docker run --rm \
  -v "$REPORTS_DIR:/zap/reports:rw" \
  -t ghcr.io/zaproxy/zaproxy \
  zap-api-scan.py \
    -t "http://host.docker.internal:3002/api/docs/spec.json" \
    -f openapi \
    -r artifex-zap-report.html \
    -w artifex-zap-report.md \
    -J artifex-zap-report.json \
    -z "replacer.full_list(0).description=auth \
        replacer.full_list(0).enabled=true \
        replacer.full_list(0).matchtype=REQ_HEADER \
        replacer.full_list(0).matchstr=Authorization \
        replacer.full_list(0).replacement=Bearer%20$TOKEN" \
    2>&1

echo ""
echo "[4/5] Scan complete!"

# 4. Show summary
echo "[5/5] Reports saved to: $REPORTS_DIR/"
echo ""
ls -la "$REPORTS_DIR/artifex-zap-report"* 2>/dev/null
echo ""

# Parse JSON report for summary if available
if [ -f "$REPORTS_DIR/artifex-zap-report.json" ]; then
  echo "=== FINDINGS SUMMARY ==="
  python3 -c "
import json
with open('$REPORTS_DIR/artifex-zap-report.json') as f:
    data = json.load(f)
alerts = data.get('site', [{}])[0].get('alerts', [])
by_risk = {}
for a in alerts:
    risk = a.get('riskdesc', 'Unknown').split(' ')[0]
    by_risk[risk] = by_risk.get(risk, 0) + 1
for risk in ['High', 'Medium', 'Low', 'Informational']:
    count = by_risk.get(risk, 0)
    print(f'  {risk}: {count}')
print(f'  Total: {len(alerts)} findings')
" 2>/dev/null || echo "  (Install python3 to see summary)"
fi

echo ""
echo "Open reports/artifex-zap-report.html in a browser for the full report."
