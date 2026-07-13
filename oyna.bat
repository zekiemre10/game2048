@echo off
REM ============================================================
REM  2048 - Oyunu baslat
REM  Bu dosyaya cift tikla: sunucu baslar ve tarayicida acilir.
REM ============================================================
cd /d "%~dp0"
set "PATH=%ProgramFiles%\nodejs;%APPDATA%\npm;%PATH%"

echo.
echo   2048 baslatiliyor...
echo   Tarayici hazir olunca otomatik acilacak (http://localhost:4200/).
echo   Kapatmak icin bu pencerede Ctrl+C yapabilirsin.
echo.

REM Bagimliliklar yoksa yukle
if not exist "node_modules" (
  echo   Ilk kez calistiriliyor, paketler yukleniyor...
  call npm install
)

call npm start -- --open
pause
