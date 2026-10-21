@echo off
REM AuroraPanel — Windows dev launcher
setlocal
cd /d "%~dp0"

if not exist ".venv" (
  echo Creating virtual environment...
  python -m venv .venv
)
call .venv\Scripts\activate.bat
python -m pip install --quiet --upgrade pip
python -m pip install --quiet -r requirements.txt

set HOST=127.0.0.1
set PORT=8088
echo.
echo AuroraPanel running at http://%HOST%:%PORT%
echo.
python -m uvicorn backend.app:app --host %HOST% --port %PORT% --reload
