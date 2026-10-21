@echo off
rem WizardStudioVoice - envia as alteracoes para o GitHub
cd /d "%~dp0"

rem Desativa as automacoes do projeto original (rodariam sozinhas e falhariam)
if not exist ".github\workflows-original" mkdir ".github\workflows-original"
for %%f in (".github\workflows\*.yml") do if /I not "%%~nxf"=="wizardstudiovoice-windows.yml" move /Y "%%f" ".github\workflows-original\" >nul
rem Instala o workflow que gera o instalador .exe
copy /Y "scripts\github\wizardstudiovoice-windows.yml" ".github\workflows\wizardstudiovoice-windows.yml" >nul

where git >nul 2>nul
if errorlevel 1 (
  echo Git nao encontrado no terminal. Abra o GitHub Desktop, faca o Commit e depois Push.
  pause
  exit /b 1
)
git add -A
git commit -m "WizardStudioVoice: instalador Windows pelo GitHub Actions"
git push
echo.
echo Pronto! Agora abra: https://github.com/And3rSgan/WizardStudioVoice/actions
echo Clique em "Gerar instalador Windows" e depois em "Run workflow".
pause
