@echo off
rem data-view launcher. Double-click to install, build and open the app.
rem This file must stay ASCII only: cmd can split non-ASCII lines wrongly and break the script.
rem
rem   start.bat          Normal run. Rebuilds automatically when the code changed (after git pull or edits).
rem   start.bat dev      Development mode. Code changes show up immediately. Slower than a normal run.
rem   start.bat update   Get the latest code (git pull), rebuild, then run.
rem   start.bat rebuild  Force a rebuild, then run.
rem   start.bat sample   Create the fake test data (fixtures folder).
rem
rem dev.bat and sample.bat in the same folder do the same as "start.bat dev" and "start.bat sample".
setlocal EnableExtensions
cd /d "%~dp0"
set "PORT=3000"
set "URL=http://127.0.0.1:%PORT%"
set "MODE=%~1"

call :check_node || goto fail
if /i "%MODE%"=="update" call :update || goto fail
call :ensure_packages || goto fail
if /i "%MODE%"=="sample" goto sample
if /i "%MODE%"=="dev" goto dev

call :ensure_build || goto fail
call :check_port
if errorlevel 2 goto already
if errorlevel 1 goto fail
call :open_browser
echo [data-view] Opening %URL% . Close this window or press Ctrl+C to stop.
call npm run start
if errorlevel 1 goto server_fail
exit /b 0

:dev
call :check_port
if errorlevel 2 goto already
if errorlevel 1 goto fail
call :open_browser
echo [data-view] Starting in development mode. Code changes show up immediately.
echo [data-view] Opening %URL% . Close this window or press Ctrl+C to stop.
call npm run dev
if errorlevel 1 goto server_fail
exit /b 0

:sample
echo [data-view] Creating fake test data.
call npm run fixtures
if errorlevel 1 goto fail
echo.
echo [data-view] Done. The data is in the fixtures folder.
echo [data-view] In the app, use the first-screen button to load it, or open this folder by path:
echo            %~dp0fixtures\game
pause
exit /b 0

:already
echo [data-view] Already running. Opening the browser only.
start "" "%URL%"
exit /b 0

rem ---- steps used above ----

:check_node
where node >nul 2>nul
if errorlevel 1 (
  echo [data-view] Node.js is not installed.
  echo [data-view] Install the LTS version from https://nodejs.org and run this again.
  exit /b 1
)
set "NODE_MAJOR=0"
for /f "delims=" %%v in ('node -p "parseInt(process.versions.node)"') do set "NODE_MAJOR=%%v"
if %NODE_MAJOR% LSS 20 (
  echo [data-view] Node.js %NODE_MAJOR% is too old.
  echo [data-view] Install version 20 or newer, LTS, from https://nodejs.org and run this again.
  exit /b 1
)
exit /b 0

:update
where git >nul 2>nul
if errorlevel 1 (
  echo [data-view] git is not installed, so the latest code cannot be downloaded.
  exit /b 1
)
echo [data-view] Getting the latest code.
git pull --ff-only
if errorlevel 1 (
  echo [data-view] Could not get the latest code. If you changed files in this folder, ask the maintainer.
  exit /b 1
)
exit /b 0

rem Packages are installed on the first run and whenever package-lock.json changes.
:ensure_packages
set "LOCK_STAMP=node_modules\.data-view-lock"
set "LOCK_NOW="
for /f "delims=" %%h in ('certutil -hashfile package-lock.json SHA256 ^| findstr /v ":"') do if not defined LOCK_NOW set "LOCK_NOW=%%h"
set "LOCK_OLD="
if exist "%LOCK_STAMP%" set /p LOCK_OLD=<"%LOCK_STAMP%"
if exist node_modules if defined LOCK_NOW if "%LOCK_NOW%"=="%LOCK_OLD%" exit /b 0
echo [data-view] Installing packages. The first time can take a few minutes.
call npm install
if errorlevel 1 (
  echo [data-view] Could not install packages. Check the network and run this again.
  exit /b 1
)
if defined LOCK_NOW (>"%LOCK_STAMP%" echo %LOCK_NOW%)
exit /b 0

rem Build only on the first run, when source files changed, or with rebuild or update.
:ensure_build
set "SRC_NOW="
for /f "delims=" %%s in ('node scripts\build-stamp.mjs') do set "SRC_NOW=%%s"
set "BUILD_STAMP=.next\data-view-build"
set "SRC_OLD="
if exist "%BUILD_STAMP%" set /p SRC_OLD=<"%BUILD_STAMP%"
set "NEED_BUILD=0"
if /i "%MODE%"=="rebuild" set "NEED_BUILD=1"
if /i "%MODE%"=="update" set "NEED_BUILD=1"
if not exist ".next\BUILD_ID" set "NEED_BUILD=1"
if not "%SRC_NOW%"=="%SRC_OLD%" set "NEED_BUILD=1"
if "%NEED_BUILD%"=="0" exit /b 0
echo [data-view] Building the app with the changed code. This takes 1 to 2 minutes.
call npm run build
if errorlevel 1 (
  echo [data-view] The build failed. Send the error text above to the maintainer.
  exit /b 1
)
>"%BUILD_STAMP%" echo %SRC_NOW%
exit /b 0

rem Returns 0 if the port is free, 2 if data-view is already running there, 1 if another program uses it.
:check_port
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul
if errorlevel 1 exit /b 0
powershell -NoProfile -Command "try { $r = Invoke-WebRequest '%URL%' -UseBasicParsing -TimeoutSec 3; if ($r.Content -match 'data-view') { exit 2 } else { exit 1 } } catch { exit 1 }"
if errorlevel 2 exit /b 2
echo [data-view] Port %PORT% is used by another program.
echo [data-view] Close that program or restart the PC, then run this again.
exit /b 1

rem Opens the browser once the server answers. Waits up to 120 seconds; dev mode needs time for the first page.
:open_browser
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 120;$i++){try{Invoke-WebRequest '%URL%' -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process '%URL%'; break}catch{Start-Sleep -Seconds 1}}"
exit /b 0

:server_fail
echo [data-view] The server stopped. Send the error text above to the maintainer.
goto fail

:fail
echo.
pause
exit /b 1
