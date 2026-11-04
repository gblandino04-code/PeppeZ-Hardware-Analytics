@echo off
setlocal EnableExtensions
chcp 65001 >nul
title PeppeZ Hardware Analytics - Installazione
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Richiedo i permessi di amministratore...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
set "SRC=%~dp0"
set "DEST=%ProgramW6432%\PeppeZ Hardware Analytics"
set "OLDDEST=%ProgramW6432%\PeppeZ System"
set "EXE=%DEST%\node_modules\electron\dist\electron.exe"
echo.
echo  ===== PeppeZ Hardware Analytics - Installazione =====
echo.
where node >nul 2>&1
if %errorlevel% neq 0 (
  echo [1/6] Node.js non trovato: lo installo con winget...
  winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
  set "PATH=%PATH%;%ProgramW6432%\nodejs"
)
where npm >nul 2>&1
if %errorlevel% neq 0 (
  echo ERRORE: Node.js non disponibile. Installalo da https://nodejs.org e rilancia questo file.
  pause
  exit /b 1
)
echo [2/6] Chiudo eventuali versioni in esecuzione e copio i file in "%DEST%"...
schtasks /End /TN "PeppeZ Hardware Analytics" >nul 2>&1
schtasks /End /TN "PeppeZ System" >nul 2>&1
schtasks /Delete /TN "PeppeZ System" /F >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and ($_.Path -like ($env:ProgramW6432 + '\PeppeZ*')) } | Stop-Process -Force -ErrorAction SilentlyContinue"
taskkill /F /IM "PeppeZ Hardware Analytics.exe" >nul 2>&1
taskkill /F /IM "PeppeZ System.exe" >nul 2>&1
timeout /t 2 /nobreak >nul
if exist "%OLDDEST%" rmdir /s /q "%OLDDEST%"
del "%PUBLIC%\Desktop\PeppeZ System.lnk" >nul 2>&1
del "%ProgramData%\Microsoft\Windows\Start Menu\Programs\PeppeZ System.lnk" >nul 2>&1
if exist "%DEST%" rmdir /s /q "%DEST%"
if exist "%DEST%" (
  echo.
  echo ERRORE: non riesco a cancellare la vecchia installazione in "%DEST%".
  echo Chiudi PeppeZ Hardware Analytics dall'icona vicino all'orologio ^(Esci^), poi rilancia INSTALLA.bat.
  pause
  exit /b 1
)
mkdir "%DEST%"
robocopy "%SRC%." "%DEST%" /E /XF *.bat *.txt /XD node_modules dist >nul
copy /Y "%DEST%\package.runtime.json" "%DEST%\package.json" >nul
echo [3/6] Installo i componenti (serve internet, puo' richiedere qualche minuto)...
set "ELECTRON_SKIP_BINARY_DOWNLOAD="
set "ELECTRON_OVERRIDE_DIST_PATH="
set "npm_config_ignore_scripts="
pushd "%DEST%"
call npm install --no-audit --no-fund --foreground-scripts --ignore-scripts=false
if not exist "%EXE%" (
  echo Scarico il motore Electron ^(secondo tentativo^)...
  call node node_modules\electron\install.js
)
if not exist "%EXE%" (
  echo Terzo tentativo: reinstallo Electron da zero...
  if exist node_modules\electron rmdir /s /q node_modules\electron
  call npm install electron@31 --no-audit --no-fund --foreground-scripts
  if not exist "%EXE%" call node node_modules\electron\install.js
)
if not exist "%EXE%" (
  echo Quarto tentativo: scarico Electron direttamente da GitHub...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try{[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;$v=(Get-Content 'node_modules\electron\package.json' -Raw | ConvertFrom-Json).version;$a='x64';if($env:PROCESSOR_ARCHITECTURE -eq 'ARM64'){$a='arm64'};$u='https://github.com/electron/electron/releases/download/v'+$v+'/electron-v'+$v+'-win32-'+$a+'.zip';$z=Join-Path $env:TEMP 'electron-pz.zip';Write-Host ('Scarico '+$u);Invoke-WebRequest -UseBasicParsing $u -OutFile $z;$d=Join-Path (Get-Location) 'node_modules\electron\dist';if(Test-Path $d){Remove-Item $d -Recurse -Force};Expand-Archive -Force $z $d;[IO.File]::WriteAllText((Join-Path (Get-Location) 'node_modules\electron\path.txt'),'electron.exe');exit 0}catch{Write-Host $_.Exception.Message;exit 1}"
)
popd
if not exist "%EXE%" (
  echo ERRORE: electron.exe non trovato in "%EXE%".
  pause
  exit /b 1
)
echo.
choice /C SN /M "[4/6] Scaricare LibreHardwareMonitor per temperature, ventole e tensioni reali (consigliato)"
if %errorlevel%==1 call :lhm
echo [5/6] Creo i collegamenti (avvio come amministratore)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$w=New-Object -ComObject WScript.Shell;foreach($p in @([Environment]::GetFolderPath('CommonDesktopDirectory'),[Environment]::GetFolderPath('CommonPrograms'))){$s=$w.CreateShortcut($p+'\PeppeZ Hardware Analytics.lnk');$s.TargetPath='%EXE%';$s.Arguments=[char]34+'%DEST%'+[char]34;$s.WorkingDirectory='%DEST%';$s.IconLocation='%DEST%\assets\icon.ico';$s.Save();$b=[IO.File]::ReadAllBytes($s.FullName);$b[0x15]=$b[0x15] -bor 0x20;[IO.File]::WriteAllBytes($s.FullName,$b)}"
echo.
choice /C SN /M "[6/6] Avviare PeppeZ Hardware Analytics con Windows (come amministratore)"
if %errorlevel%==1 schtasks /Create /TN "PeppeZ Hardware Analytics" /TR "\"%EXE%\" \"%DEST%\" --hidden" /SC ONLOGON /RL HIGHEST /F >nul
echo.
echo Installazione completata! Avvio PeppeZ Hardware Analytics...
start "" "%EXE%" "%DEST%"
timeout /t 4 >nul
exit /b 0

:lhm
echo Scarico LibreHardwareMonitor...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try{[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;Invoke-WebRequest -UseBasicParsing 'https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/latest/download/LibreHardwareMonitor.zip' -OutFile '%TEMP%\lhm.zip';Expand-Archive -Force '%TEMP%\lhm.zip' '%DEST%\LibreHardwareMonitor';exit 0}catch{exit 1}"
if errorlevel 1 goto lhmfail
set "LHMEXE="
for /r "%DEST%\LibreHardwareMonitor" %%F in (LibreHardwareMonitor.exe) do set "LHMEXE=%%F"
if not defined LHMEXE goto lhmfail
for %%I in ("%LHMEXE%") do set "LHMDIR=%%~dpI"
> "%DEST%\lhm.path" echo %LHMEXE%
(
echo ^<?xml version="1.0" encoding="utf-8"?^>
echo ^<configuration^>
echo   ^<appSettings^>
echo     ^<add key="runWebServerMenuItem" value="true" /^>
echo     ^<add key="listenerPort" value="8085" /^>
echo     ^<add key="minTrayMenuItem" value="true" /^>
echo     ^<add key="startMinMenuItem" value="true" /^>
echo   ^</appSettings^>
echo ^</configuration^>
) > "%LHMDIR%LibreHardwareMonitor.config"
echo LibreHardwareMonitor installato.
echo Controllo il driver PawnIO ^(serve per leggere la temperatura della CPU^)...
sc query PawnIO >nul 2>&1
if errorlevel 1 (
  winget install -e --id namazso.PawnIO --silent --accept-package-agreements --accept-source-agreements
) else echo PawnIO gia' presente.
goto :eof
:lhmfail
echo Download non riuscito.
goto :eof
