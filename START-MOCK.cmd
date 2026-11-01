@echo off
cd /d "%~dp0"
py server.py --mock --port 8001
pause
