@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo ==========================================
echo   Soi Vocab 빌드 검증 및 자동 배포 시작
echo ==========================================
echo.

set /p COMMIT_MSG="커밋 메시지를 입력하세요 (그냥 Enter 누르면 자동 입력): "
if "%COMMIT_MSG%"=="" set COMMIT_MSG=Update Soi Vocab (%date% %time:~0,5%)

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
echo [2/4] 변경된 파일 스테이징 (git add)...
git add .

echo.
echo [3/4] 커밋 생성 중... ("%COMMIT_MSG%")
git commit -m "%COMMIT_MSG%"
if errorlevel 1 (
    echo.
    echo [안내] 새로 커밋할 변경사항이 없거나 이미 커밋된 상태입니다.
)

echo.
echo [4/4] GitHub 업로드 및 자동 배포 시작 (git push)...
git push
if errorlevel 1 (
    echo.
    echo [오류] git push에 실패했습니다. 인터넷 연결이나 Git 상태를 확인해 주세요.
    pause
    exit /b 1
)

echo.
echo ==========================================
echo   배포 요청 완료! 약 1분 후 앱에 반영됩니다.
echo ==========================================
pause