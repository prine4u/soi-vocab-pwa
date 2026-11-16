@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

echo ==========================================
echo   Soi Vocab 빌드 검증 · 버전 백업 · 자동 배포
echo ==========================================
echo.

set /p COMMIT_MSG="버전 메모(커밋 메시지)를 입력하세요 (Enter 시 자동 입력): "
if "%COMMIT_MSG%"=="" set COMMIT_MSG=UI and feature update

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format 'yyyyMMdd_HHmmss'"') do set TIMESTAMP=%%i
set SAFE_MSG=%COMMIT_MSG: =_%
set SAFE_MSG=%SAFE_MSG:/=-%
set SAFE_MSG=%SAFE_MSG:\=-%
set SAFE_MSG=%SAFE_MSG::=-%
set BACKUP_DIR=_backups\%TIMESTAMP%_%SAFE_MSG%

echo.
echo [1/4] TypeScript 검증 및 프로덕션 빌드 중...
call npm run build
if errorlevel 1 (
    echo.
    echo [오류] 빌드에 실패했습니다. 배포를 중단합니다.
    pause
    exit /b 1
)

echo.
echo [2/4] 현재 버전 로컬 백업 생성 중 (%BACKUP_DIR%)...
if not exist "_backups" mkdir "_backups"
mkdir "%BACKUP_DIR%"
xcopy "src" "%BACKUP_DIR%\src\" /E /I /Q /Y >nul
if exist "public" xcopy "public" "%BACKUP_DIR%\public\" /E /I /Q /Y >nul
for %%F in (index.html package.json package-lock.json vite.config.ts tsconfig.json tsconfig.app.json) do (
    if exist "%%F" copy /Y "%%F" "%BACKUP_DIR%\" >nul
)
echo %COMMIT_MSG% > "%BACKUP_DIR%\version_note.txt"
echo   -^> 백업 완료: %BACKUP_DIR%

echo.
echo [3/4] Git 저장소에 커밋 및 버전 태그 기록 중...
git add .
git commit -m "%COMMIT_MSG%"
git tag -f "v_%TIMESTAMP%" >nul 2>&1

echo.
echo [4/4] 원격 저장소(GitHub / Vercel)로 푸시 중...
git push
git push --tags --force >nul 2>&1

echo.
echo ==========================================
echo   배포 및 버전 백업이 완료되었습니다!
echo   백업 위치: %BACKUP_DIR%
echo ==========================================
pause