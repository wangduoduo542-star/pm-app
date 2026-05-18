@echo off
chcp 65001 >nul
echo ============================
echo   PM Sync - Firewall Allow
echo ============================
echo.
echo Adding firewall rule for port 3456...
netsh advfirewall firewall add rule name="PM_Sync" dir=in action=allow protocol=TCP localport=3456
echo.
if %errorlevel%==0 (
  echo [OK] Rule added. Phone can now connect.
) else (
  echo [FAIL] Please right-click and Run as Administrator.
)
echo.
pause
