@echo off
setlocal EnableExtensions
REM ---------------------------------------------------------------------------
REM Tabby (tableau_mcp_tabby) launcher for Windows.
REM Edit TABBY_DIR if the project lives somewhere else.
REM ---------------------------------------------------------------------------
set "TABBY_DIR=C:\Users\LabUser\Downloads\tableau_mcp_tabby"

cd /d "%TABBY_DIR%" 2>nul
if errorlevel 1 (
    echo Could not cd to: %TABBY_DIR%
    pause
    exit /b 1
)

set "VENV_ACT="
if exist ".venv\Scripts\activate.bat" set "VENV_ACT=.venv\Scripts\activate.bat"
if not defined VENV_ACT if exist "venv\Scripts\activate.bat" set "VENV_ACT=venv\Scripts\activate.bat"
if not defined VENV_ACT (
    echo No virtualenv found. Create one in this folder, e.g.:
    echo   python -m venv .venv
    echo   .venv\Scripts\activate
    echo   pip install -r requirements.txt
    pause
    exit /b 1
)

REM Run the server in a new window so this script can open the browser.
REM Parent has already cd'd to TABBY_DIR so %%CD%% expands to the project root.
start "Tabby - web_app.py" cmd /k "cd /d \"%CD%\" && call \"%CD%\%VENV_ACT%\" && python web_app.py"

REM Give uvicorn a moment to bind before opening the browser.
timeout /t 4 /nobreak >nul

set "CHROME="
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
)

if defined CHROME (
    start "" "%CHROME%" "http://localhost:8000/"
) else (
    echo Chrome not found in default locations; opening the URL in your default browser.
    start "" "http://localhost:8000/"
)

endlocal
exit /b 0
