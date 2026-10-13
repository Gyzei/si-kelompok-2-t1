@echo off
cd /d "%~dp0"
node --use-system-ca scripts\collect.mjs %*
pause
