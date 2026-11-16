@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

echo ==========================================
echo   Soi Vocab 버전별 롤백(복원) 도구
echo ==========================================
echo.

if not exist "_backups" (
    echo [안내] 아직 저장된 백업 폴더^(_backups^)가 없습니다.
    echo deploy.bat을 먼저 실행하면 버전별 백업이 자동으로 생성됩니다.
    pause
    exit /b 1
)

set COUNT=0
for /f "delims=" %%D in ('dir /b /ad /o-n "_backups"') do (
    set /a COUNT+=1
    set "VER_!COUNT!=%%D"
    set "NOTE="
    if exist "_backups\%%D\version_note.txt" (
        set /p NOTE=<"_backups\%%D\version_note.txt"
    )
    echo   [!COUNT!] %%D   ^(!NOTE!^)
)

if %COUNT%==0 (
    echo [안내] 복원할 수 있는 백업 버전이 없습니다.
    pause
    exit /b 1
)

echo.
set /p CHOICE="복원할 버전 번호를 입력하세요 (취소하려면 Enter): "
if "%CHOICE%"=="" exit /b 0

set "TARGET=!VER_%CHOICE%!"
if "%TARGET%"=="" (
    echo [오류] 잘못된 번호입니다.
    pause
    exit /b 1
)

echo.
echo 선택된 버전: %TARGET%
set /p CONFIRM="정말 이 버전으로 되돌리시겠습니까? (Y/N): "
if /i not "%CONFIRM%"=="Y" (
    echo 롤백을 취소했습니다.
    pause
    exit /b 0
)

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format 'yyyyMMdd_HHmmss'"') do set NOW_TS=%%i
set SAFETY_DIR=_backups\auto_before_rollback_%NOW_TS%
mkdir "%SAFETY_DIR%"
xcopy "src" "%SAFETY_DIR%\src\" /E /I /Q /Y >nul
echo 롤백 직전 자동 안전 백업 > "%SAFETY_DIR%\version_note.txt"

echo.
echo [1/2] 선택한 버전(%TARGET%)으로 파일 복원 중...
rmdir /s /q "src"
xcopy "_backups\%TARGET%\src" "src\" /E /I /Q /Y >nul
if exist "_backups\%TARGET%\public" (
    rmdir /s /q "public"
    xcopy "_backups\%TARGET%\public" "public\" /E /I /Q /Y >nul
)
for %%F in (index.html package.json package-lock.json vite.config.ts tsconfig.json tsconfig.app.json) do (
    if exist "_backups\%TARGET%\%%F" copy /Y "_backups\%TARGET%\%%F" "%%F" >nul
)

echo [2/2] 로컬 소스 코드가 [%TARGET%] 버전으로 복원되었습니다!
echo (직전 상태는 %SAFETY_DIR% 에 안전하게 보관되었습니다.)
echo.
set /p DO_DEPLOY="복원된 버전으로 지금 바로 웹사이트 재배포(deploy.bat)까지 실행할까요? (Y/N): "
if /i "%DO_DEPLOY%"=="Y" (
    call deploy.bat
    exit /b 0
)

echo 완료되었습니다. 로컬에서 확인 후 필요할 때 deploy.bat을 실행하세요.
pause