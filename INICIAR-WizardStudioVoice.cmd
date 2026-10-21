@echo off
rem WizardStudioVoice - iniciar
cd /d "%~dp0"
if not exist logs mkdir logs
node "electron\scripts\wizard-launch.mjs" > "logs\ultimo-inicio.log" 2>&1
