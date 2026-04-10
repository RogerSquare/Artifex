# OWASP ZAP Security Scan for Artifex API (Windows PowerShell)
#
# Prerequisites:
#   - Docker Desktop installed and running
#   - Artifex backend running on localhost:3002
#
# Usage:
#   cd ai-gallery\backend\security
#   .\run-zap-scan.ps1

$ErrorActionPreference = "Continue"
$REPORTS_DIR = "$PSScriptRoot\reports"

New-Item -ItemType Directory -Force -Path $REPORTS_DIR | Out-Null

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Artifex API - OWASP ZAP Security Scan" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check backend
Write-Host "[1/5] Checking backend..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3002/api/health" -Method Get
    Write-Host "  Backend OK: $($health.status)" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Backend not running on port 3002" -ForegroundColor Red
    exit 1
}

# 2. Get auth token
Write-Host "[2/5] Creating test user..." -ForegroundColor Yellow
$body = '{"username":"zaptest","password":"ZapTest123!","display_name":"ZAP Scanner"}'
$token = ""
try {
    $reg = Invoke-RestMethod -Uri "http://localhost:3002/api/auth/register" -Method Post -Body $body -ContentType "application/json"
    $token = $reg.token
} catch {
    try {
        $login = Invoke-RestMethod -Uri "http://localhost:3002/api/auth/login" -Method Post -Body '{"username":"zaptest","password":"ZapTest123!"}' -ContentType "application/json"
        $token = $login.token
    } catch {
        $token = ""
    }
}

if ($token) {
    Write-Host "  Got auth token" -ForegroundColor Green
} else {
    Write-Host "  WARNING: No auth token - scanning unauthenticated" -ForegroundColor Yellow
}

# 3. Run ZAP in a named container (so we can copy reports out)
$containerName = "artifex-zap-scan"
docker rm -f $containerName 2>&1 | Out-Null

Write-Host "[3/5] Running ZAP API scan (5-15 minutes)..." -ForegroundColor Yellow
Write-Host "  Scanning all API endpoints from OpenAPI spec" -ForegroundColor Gray
Write-Host ""

# Convert Windows path to Docker-compatible mount path
$dockerReportsDir = $REPORTS_DIR -replace '\\','/' -replace '^([A-Za-z]):','/$1'
$dockerReportsDir = $dockerReportsDir.ToLower()

docker run --rm `
    -v "${dockerReportsDir}:/zap/wrk:rw" `
    -t ghcr.io/zaproxy/zaproxy `
    zap-api-scan.py `
    -t "http://host.docker.internal:3002/api/docs/spec.json" `
    -f openapi `
    -r artifex-zap-report.html `
    -J artifex-zap-report.json `
    -z "replacer.full_list(0).description=auth replacer.full_list(0).enabled=true replacer.full_list(0).matchtype=REQ_HEADER replacer.full_list(0).matchstr=Authorization replacer.full_list(0).replacement=Bearer%20$token"

Write-Host ""
Write-Host "[4/5] Reports written..." -ForegroundColor Yellow

# 5. Results
Write-Host "[5/5] Scan complete!" -ForegroundColor Green
Write-Host ""

$files = Get-ChildItem "$REPORTS_DIR\artifex-zap-report*" -ErrorAction SilentlyContinue
if ($files) {
    Write-Host "Reports:" -ForegroundColor Cyan
    $files | Format-Table Name, @{N="Size";E={"{0:N0} KB" -f ($_.Length/1024)}} -AutoSize

    # Parse JSON for summary
    $jsonPath = "$REPORTS_DIR\artifex-zap-report.json"
    if (Test-Path $jsonPath) {
        $json = Get-Content $jsonPath | ConvertFrom-Json
        $alerts = $json.site[0].alerts
        Write-Host "=== FINDINGS SUMMARY ===" -ForegroundColor Cyan
        $high = ($alerts | Where-Object { $_.riskdesc -like "High*" }).Count
        $medium = ($alerts | Where-Object { $_.riskdesc -like "Medium*" }).Count
        $low = ($alerts | Where-Object { $_.riskdesc -like "Low*" }).Count
        $info = ($alerts | Where-Object { $_.riskdesc -like "Informational*" }).Count
        Write-Host "  High:          $high" -ForegroundColor $(if ($high -gt 0) { "Red" } else { "Green" })
        Write-Host "  Medium:        $medium" -ForegroundColor $(if ($medium -gt 0) { "Yellow" } else { "Green" })
        Write-Host "  Low:           $low" -ForegroundColor Gray
        Write-Host "  Informational: $info" -ForegroundColor Gray
        Write-Host "  Total:         $($alerts.Count) findings" -ForegroundColor White
    }

    Write-Host ""
    Write-Host "Open the HTML report:" -ForegroundColor Yellow
    Write-Host "  start $REPORTS_DIR\artifex-zap-report.html" -ForegroundColor White
} else {
    Write-Host "WARNING: No reports found. Check Docker output above for errors." -ForegroundColor Red
    Write-Host "Common fixes:" -ForegroundColor Yellow
    Write-Host "  - Ensure Docker Desktop is running" -ForegroundColor Gray
    Write-Host "  - Ensure backend is running on port 3002" -ForegroundColor Gray
    Write-Host "  - Check that host.docker.internal resolves" -ForegroundColor Gray
}
