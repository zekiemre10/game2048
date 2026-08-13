@echo off
REM ============================================================
REM  2048 - Oyunu baslat
REM  Bu dosyaya cift tikla: sunucu baslar ve tarayicida acilir.
REM ============================================================
cd /d "%~dp0"
set "PATH=%ProgramFiles%\nodejs;%APPDATA%\npm;%PATH%"

REM --- Node kurulu mu? -----------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   HATA: Node.js bulunamadi.
  echo   Angular 22 icin Node 22.22.3+ ^(veya 24.15.0+ / 26.0.0+^) gerekir.
  echo   Kur: https://nodejs.org
  echo.
  pause
  exit /b 1
)

REM --- Node surumu yeterli mi? (semver kontrolunu node yapar) ---
for /f "delims=" %%v in ('node -v') do set "NODEV=%%v"
node -e "var v=process.versions.node.split('.').map(Number);process.exit((v[0]>26||v[0]===26||(v[0]===24&&v[1]>=15)||(v[0]===22&&(v[1]>22||(v[1]===22&&v[2]>=3))))?0:1);"
if errorlevel 1 (
  echo.
  echo   HATA: Node surumun %NODEV% cok eski.
  echo   Angular 22 icin en az Node 22.22.3 ^(veya 24.15.0+ / 26.0.0+^) gerekir.
  echo   Guncelle: https://nodejs.org   ^(nvm-windows ile: nvm install 22.22.3^)
  echo.
  pause
  exit /b 1
)

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
