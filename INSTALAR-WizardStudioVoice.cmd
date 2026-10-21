@echo off
rem WizardStudioVoice - instalar / atualizar
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALAR-WizardStudioVoice.ps1"
echo.
pause
