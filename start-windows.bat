@echo off
setlocal

cd /d "%~dp0"
title Hilihili Player Launcher

echo.
echo ========================================
echo   Hilihili Player - Windows Launcher
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found.
  echo Install Node.js 24 LTS first, then run this script again.
  pause
  exit /b 1
)

node --version

if not defined HILI_API_HOST set "HILI_API_HOST=0.0.0.0"
if not defined HILI_API_PORT set "HILI_API_PORT=4141"
if not defined HILI_DATA_DIR set "HILI_DATA_DIR=%CD%\app-data"
if not defined HILI_SCAN_INTERVAL_MS set "HILI_SCAN_INTERVAL_MS=900000"
if not defined NEXT_PUBLIC_API_BASE_URL set "NEXT_PUBLIC_API_BASE_URL=http://localhost:%HILI_API_PORT%"

if not exist "%HILI_DATA_DIR%" mkdir "%HILI_DATA_DIR%"

echo Data dir: %HILI_DATA_DIR%
echo API:      http://localhost:%HILI_API_PORT%
echo Web:      http://localhost:3000
echo.

where corepack >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Corepack was not found. It should come with modern Node.js.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies. This may take a while the first time...
  corepack pnpm install
  if errorlevel 1 (
    echo.
    echo [ERROR] Dependency install failed.
    pause
    exit /b 1
  )
)

echo Starting services in this window...
echo Press Ctrl+C and then Y to stop all services.
echo.

corepack pnpm --parallel --filter @hilihili/web --filter @hilihili/api --filter @hilihili/worker dev
if errorlevel 1 (
  echo.
  echo [ERROR] Service startup failed.
  pause
  exit /b 1
)
