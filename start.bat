@echo off
rem data-view 실행 파일. 더블 클릭하면 필요한 준비(설치, 빌드)를 알아서 하고 브라우저를 연다.
rem
rem   start.bat          보통 실행. 코드가 바뀌었으면(git pull 뒤나 파일을 고친 뒤) 알아서 다시 빌드한다.
rem   start.bat dev      개발 모드. 코드를 고치면 화면에 바로 반영된다. 보통 실행보다 느리다.
rem   start.bat update   최신 코드를 받고(git pull) 다시 빌드한 뒤 실행한다.
rem   start.bat rebuild  빌드를 강제로 다시 한 뒤 실행한다.
rem   start.bat sample   게임 테스트 데이터(fixtures 폴더)를 만든다.
rem
rem 개발 모드와 테스트 데이터는 같은 폴더의 "개발모드.bat", "테스트데이터.bat"으로도 켤 수 있다.
chcp 65001 >nul
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
echo [data-view] %URL% 에서 엽니다. 끝내려면 이 창을 닫거나 Ctrl+C를 누르세요.
call npm run start
if errorlevel 1 goto server_fail
exit /b 0

:dev
call :check_port
if errorlevel 2 goto already
if errorlevel 1 goto fail
call :open_browser
echo [data-view] 개발 모드로 켭니다. 코드를 고치면 화면에 바로 반영됩니다.
echo [data-view] %URL% 에서 엽니다. 끝내려면 이 창을 닫거나 Ctrl+C를 누르세요.
call npm run dev
if errorlevel 1 goto server_fail
exit /b 0

:sample
echo [data-view] 게임 테스트 데이터를 만듭니다.
call npm run fixtures
if errorlevel 1 goto fail
echo.
echo [data-view] fixtures 폴더에 만들었습니다.
echo [data-view] 앱의 파일 불러오기 - 게임 데이터 테이블 - 경로 지정에 아래 위치를 넣어 보세요.
echo            %~dp0fixtures\game
pause
exit /b 0

:already
echo [data-view] 이미 켜져 있습니다. 브라우저만 엽니다.
start "" "%URL%"
exit /b 0

rem ---- 아래는 위에서 부르는 단계들 ----

:check_node
where node >nul 2>nul
if errorlevel 1 (
  echo [data-view] Node.js가 설치되어 있지 않습니다.
  echo [data-view] https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해 주세요.
  exit /b 1
)
set "NODE_MAJOR=0"
for /f "delims=" %%v in ('node -p "parseInt(process.versions.node)"') do set "NODE_MAJOR=%%v"
if %NODE_MAJOR% LSS 20 (
  echo [data-view] 설치된 Node.js가 %NODE_MAJOR% 버전이라 너무 오래되었습니다.
  echo [data-view] https://nodejs.org 에서 20 이상 LTS 버전을 설치한 뒤 다시 실행해 주세요.
  exit /b 1
)
exit /b 0

:update
where git >nul 2>nul
if errorlevel 1 (
  echo [data-view] git이 설치되어 있지 않아 최신 코드를 받을 수 없습니다.
  exit /b 1
)
echo [data-view] 최신 코드를 받습니다.
git pull --ff-only
if errorlevel 1 (
  echo [data-view] 최신 코드를 받지 못했습니다. 이 폴더에서 직접 고친 파일이 있으면 담당자에게 문의해 주세요.
  exit /b 1
)
exit /b 0

rem 패키지는 처음 실행할 때와 package-lock.json이 바뀌었을 때만 설치한다.
:ensure_packages
set "LOCK_STAMP=node_modules\.data-view-lock"
set "LOCK_NOW="
for /f "delims=" %%h in ('certutil -hashfile package-lock.json SHA256 ^| findstr /v ":"') do if not defined LOCK_NOW set "LOCK_NOW=%%h"
set "LOCK_OLD="
if exist "%LOCK_STAMP%" set /p LOCK_OLD=<"%LOCK_STAMP%"
if exist node_modules if defined LOCK_NOW if "%LOCK_NOW%"=="%LOCK_OLD%" exit /b 0
echo [data-view] 필요한 패키지를 설치합니다. 처음에는 몇 분 걸릴 수 있습니다.
call npm install
if errorlevel 1 (
  echo [data-view] 패키지를 설치하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 실행해 주세요.
  exit /b 1
)
if defined LOCK_NOW (>"%LOCK_STAMP%" echo %LOCK_NOW%)
exit /b 0

rem 빌드는 처음이거나, 소스 파일이 바뀌었거나, rebuild나 update로 켰을 때만 한다.
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
echo [data-view] 바뀐 코드로 실행 파일을 새로 만듭니다. 1~2분 걸립니다.
call npm run build
if errorlevel 1 (
  echo [data-view] 빌드에 실패했습니다. 위의 오류 내용을 개발 담당자에게 전달해 주세요.
  exit /b 1
)
>"%BUILD_STAMP%" echo %SRC_NOW%
exit /b 0

rem 포트가 비어 있으면 0, 이미 data-view가 켜져 있으면 2, 다른 프로그램이 쓰고 있으면 1.
:check_port
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul
if errorlevel 1 exit /b 0
powershell -NoProfile -Command "try { $r = Invoke-WebRequest '%URL%' -UseBasicParsing -TimeoutSec 3; if ($r.Content -match 'data-view') { exit 2 } else { exit 1 } } catch { exit 1 }"
if errorlevel 2 exit /b 2
echo [data-view] %PORT%번 포트를 다른 프로그램이 쓰고 있습니다.
echo [data-view] 그 프로그램을 끄거나 PC를 다시 시작한 뒤 실행해 주세요.
exit /b 1

rem 서버가 응답하면 브라우저를 연다. 최대 120초 기다린다. 개발 모드는 첫 화면을 만드는 데 시간이 걸린다.
:open_browser
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 120;$i++){try{Invoke-WebRequest '%URL%' -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process '%URL%'; break}catch{Start-Sleep -Seconds 1}}"
exit /b 0

:server_fail
echo [data-view] 서버가 멈췄습니다. 위의 오류 내용을 개발 담당자에게 전달해 주세요.
goto fail

:fail
echo.
pause
exit /b 1
