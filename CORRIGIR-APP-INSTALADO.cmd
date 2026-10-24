@echo off
rem WizardStudioVoice - aplica as correcoes do motor (backend) no app ja instalado
rem Pede permissao de administrador (a pasta Program Files exige)
net session >nul 2>nul
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
cd /d "%~dp0"
set "DEST=C:\Program Files\WizardStudioVoice\resources\backend"
if not exist "%DEST%" (
  echo Nao achei o WizardStudioVoice instalado em "%DEST%".
  pause
  exit /b 1
)
tasklist /FI "IMAGENAME eq WizardStudioVoice.exe" | find /I "WizardStudioVoice.exe" >nul
if not errorlevel 1 (
  echo Feche o WizardStudioVoice antes de continuar.
  pause
)
echo Copiando as correcoes...
robocopy "%~dp0backend" "%DEST%" /E /XD __pycache__ /XF *.pyc /NFL /NDL /NJH /NJS /NP
if errorlevel 8 (
  echo Algo deu errado ao copiar. Veja a mensagem acima.
  pause
  exit /b 1
)
echo.
echo Pronto! Abra o WizardStudioVoice de novo.
pause
