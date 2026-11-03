@echo off
rem data-view 실행. IDE 없이 더블 클릭으로 켠다.
rem 처음에는 패키지 설치와 빌드를 하고, 그다음부터는 바로 서버를 띄운다.
rem 코드를 새로 받은 뒤에는 "start.bat rebuild"로 빌드를 다시 한다.
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [data-view] Node.js가 설치되어 있지 않습니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해 주세요.
  goto fail
)

if not exist node_modules (
  echo [data-view] 처음 실행이라 패키지를 설치합니다. 몇 분 걸릴 수 있습니다.
  call npm install
  if errorlevel 1 goto fail
)

set NEED_BUILD=0
if /i "%~1"=="rebuild" set NEED_BUILD=1
if not exist ".next\BUILD_ID" set NEED_BUILD=1
if "%NEED_BUILD%"=="1" (
  echo [data-view] 프로덕션 빌드를 만듭니다.
  call npm run build
  if errorlevel 1 goto fail
)

rem 서버가 응답하면 브라우저를 연다. 최대 60초 기다린다.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 60;$i++){try{Invoke-WebRequest 'http://127.0.0.1:3000' -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process 'http://127.0.0.1:3000'; break}catch{Start-Sleep -Seconds 1}}"

echo [data-view] http://127.0.0.1:3000 에서 엽니다. 끝내려면 이 창을 닫거나 Ctrl+C를 누르세요.
call npm run start
if errorlevel 1 (
  echo [data-view] 서버를 띄우지 못했습니다. 3000번 포트를 다른 프로그램이 쓰고 있는지 확인해 주세요.
  goto fail
)
exit /b 0

:fail
echo.
pause
exit /b 1
