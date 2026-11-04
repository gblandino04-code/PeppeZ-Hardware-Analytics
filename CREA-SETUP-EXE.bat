@echo off
setlocal EnableExtensions
chcp 65001 >nul
title PeppeZ Hardware Analytics - Crea Setup.exe
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
cd /d "%~dp0"
where node >nul 2>&1
if %errorlevel% neq 0 (
  echo Installo Node.js LTS...
  winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
  set "PATH=%PATH%;%ProgramW6432%\nodejs"
)
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npm install --no-audit --no-fund
call npm run dist
echo.
echo Fatto! Trovi il programma di installazione (Setup .exe) di PeppeZ Hardware Analytics nella cartella "dist".
pause
