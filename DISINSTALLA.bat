@echo off
setlocal EnableExtensions
chcp 65001 >nul
title PeppeZ Hardware Analytics - Disinstallazione
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
echo Chiudi PeppeZ Hardware Analytics (icona vicino all'orologio - Esci) e premi un tasto.
pause >nul
schtasks /Delete /TN "PeppeZ Hardware Analytics" /F >nul 2>&1
schtasks /Delete /TN "PeppeZ System" /F >nul 2>&1
del "%PUBLIC%\Desktop\PeppeZ Hardware Analytics.lnk" >nul 2>&1
del "%PUBLIC%\Desktop\PeppeZ System.lnk" >nul 2>&1
del "%ProgramData%\Microsoft\Windows\Start Menu\Programs\PeppeZ Hardware Analytics.lnk" >nul 2>&1
del "%ProgramData%\Microsoft\Windows\Start Menu\Programs\PeppeZ System.lnk" >nul 2>&1
if exist "%ProgramW6432%\PeppeZ Hardware Analytics" rmdir /s /q "%ProgramW6432%\PeppeZ Hardware Analytics"
if exist "%ProgramW6432%\PeppeZ System" rmdir /s /q "%ProgramW6432%\PeppeZ System"
choice /C SN /M "Eliminare anche impostazioni, storico diagnostica e widget salvati"
if %errorlevel%==1 (
  if exist "%APPDATA%\peppez-hardware-analytics" rmdir /s /q "%APPDATA%\peppez-hardware-analytics"
  if exist "%APPDATA%\peppez-system" rmdir /s /q "%APPDATA%\peppez-system"
)
echo Disinstallazione completata.
pause
