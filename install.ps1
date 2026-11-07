<#
.SYNOPSIS
  CleanYourTV · LG QNED83SRA (webOS No-Root) Liquid Glass Studio & Installer for Windows.

.DESCRIPTION
  - Automatically sets up a local Python virtual environment (`.venv`) and installs `websockets` + `paramiko`
  - If called with no arguments (or `-Studio`), launches the local Web Dashboard & Live TV Simulator at http://localhost:8780
  - If called with `-TvHost <IP>` (and optional `-Passphrase <6-char>`), deploys Liquid Glass Home + On-TV Home Helper directly from the terminal
  - If called with `-Restore -TvHost <IP>`, removes the custom launcher and restores stock LG Home

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -TvHost 192.168.1.50 -Passphrase ABC123
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -Restore -TvHost 192.168.1.50
#>
param(
    [string]$TvHost = "",
    [string]$Passphrase = "",
    [switch]$Studio = $false,
    [switch]$Restore = $false
)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "  CleanYourTV · LG QNED83SRA (webOS No-Root) Liquid Glass Setup" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan

# Locate Python 3.9+ on Windows
$PythonCmd = $null
foreach ($candidate in @("python", "py")) {
    if (Get-Command $candidate -ErrorAction SilentlyContinue) {
        $PythonCmd = $candidate
        break
    }
}

if (-not $PythonCmd) {
    Write-Host "ERROR: Python 3.9+ was not found on your PATH. Install Python from https://www.python.org/downloads/windows/ and check 'Add Python to PATH'." -ForegroundColor Red
    exit 1
}

# Create virtual environment if needed
if (-not (Test-Path ".venv\Scripts\python.exe")) {
    Write-Host "[1/2] Creating local Python virtual environment (.venv)..." -ForegroundColor Yellow
    & $PythonCmd -m venv .venv
}

$VenvPython = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
Write-Host "[2/2] Verifying Python dependencies (websockets, paramiko)..." -ForegroundColor Yellow
& $VenvPython -m pip install --quiet --upgrade pip
& $VenvPython -m pip install --quiet -r requirements.txt

if ($Restore) {
    if (-not $TvHost) {
        $TvHost = Read-Host "Enter your LG QNED83SRA IPv4 address"
    }
    & $VenvPython tv_deployer.py $TvHost --passphrase "$Passphrase" --uninstall
    exit $LASTEXITCODE
}

if ($TvHost -and -not $Studio) {
    & $VenvPython tv_deployer.py $TvHost --passphrase "$Passphrase"
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Launching CleanYourTV Studio & Live 1080p TV Simulator in your browser..." -ForegroundColor Green
& $VenvPython studio_server.py
