# WizardStudioVoice - instalador a partir do codigo-fonte
# Pode rodar de novo a qualquer momento: ele so instala o que faltar e recompila.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
$Nome = 'WizardStudioVoice'

function Passo($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg)    { Write-Host "    OK: $msg" -ForegroundColor Green }
function Aviso($msg) { Write-Host "    ATENÇÃO: $msg" -ForegroundColor Yellow }
function Tem($cmd)   { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function AtualizarPath {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
              [Environment]::GetEnvironmentVariable('Path', 'User') + ';' +
              "$env:USERPROFILE\.bun\bin;$env:USERPROFILE\.local\bin"
}
function Rodar($desc, [scriptblock]$bloco) {
  & $bloco
  if ($LASTEXITCODE -ne 0) { throw "Falhou: $desc (código $LASTEXITCODE)" }
}

Write-Host "============================================" -ForegroundColor Magenta
Write-Host "   Instalando $Nome" -ForegroundColor Magenta
Write-Host "   Pasta: $Root" -ForegroundColor Magenta
Write-Host "============================================" -ForegroundColor Magenta
AtualizarPath

# 0. Fechar o VoiceStudio antigo (os dois usam a mesma porta 3900)
$antigo = Get-Process -Name 'VoiceStudio' -ErrorAction SilentlyContinue
if ($antigo) {
  Aviso 'O VoiceStudio antigo está aberto. Ele precisa ser fechado (usa a mesma porta).'
  Read-Host '    Pressione ENTER para fechá-lo e continuar'
  $antigo | Stop-Process -Force
}

# 1. Node.js 22+
Passo 'Verificando Node.js'
$precisaNode = -not (Tem 'node')
if (-not $precisaNode) {
  $maior = [int]((node -v).TrimStart('v').Split('.')[0])
  if ($maior -lt 22) { $precisaNode = $true }
}
if ($precisaNode) {
  if (-not (Tem 'winget')) { throw 'Instale o Node.js LTS manualmente em https://nodejs.org e rode este instalador de novo.' }
  Rodar 'instalar Node.js' { winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements }
  AtualizarPath
}
Ok "Node $(node -v)"

# 2. Bun
Passo 'Verificando Bun'
if (-not (Tem 'bun')) {
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm bun.sh/install.ps1 | iex"
  AtualizarPath
}
if (-not (Tem 'bun')) { throw 'Bun não foi instalado. Veja https://bun.sh' }
Ok "Bun $(bun --version)"

# 3. uv (gerencia o Python 3.11 e as bibliotecas de IA)
Passo 'Verificando uv (Python)'
if (-not (Tem 'uv')) {
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
  AtualizarPath
}
if (-not (Tem 'uv')) { throw 'uv não foi instalado. Veja https://docs.astral.sh/uv/' }
Ok "$(uv --version)"

# 4. Dependências da interface
Passo 'Instalando dependências da interface (bun install)'
Rodar 'bun install' { bun install }
Ok 'Dependências da interface prontas'

# 5. Python + PyTorch + modelos de voz (demora e baixa vários GB na primeira vez)
Passo 'Preparando o motor de voz (Python/PyTorch) - pode demorar bastante na primeira vez'
Rodar 'setup:api' { bun run setup:api }
Ok 'Motor de voz pronto'

# 6. Compilar o app
Passo "Compilando o $Nome"
Rodar 'build' { bun run build }
Ok 'App compilado'

# 7. Baixar o Electron agora (para o primeiro início ser rápido)
Passo 'Preparando o Electron'
Push-Location (Join-Path $Root 'electron')
Rodar 'electron' { node -e "console.log(require('electron'))" }
Pop-Location
Ok 'Electron pronto'

# 8. Reaproveitar vozes/modelos do VoiceStudio instalado antes
Passo 'Procurando vozes e modelos do VoiceStudio antigo'
$loc = Join-Path $env:APPDATA 'VoiceStudio\runtime-location.json'
$padrao = Join-Path $env:APPDATA 'OmniVoice'
if (Test-Path $loc) {
  try {
    $cfg = Get-Content $loc -Raw | ConvertFrom-Json
    if ($cfg.scoped -and $cfg.root -and (Test-Path (Join-Path $cfg.root 'data'))) {
      if (-not [Environment]::GetEnvironmentVariable('OMNIVOICE_DATA_DIR', 'User')) {
        [Environment]::SetEnvironmentVariable('OMNIVOICE_DATA_DIR', (Join-Path $cfg.root 'data'), 'User')
      }
      if ((Test-Path (Join-Path $cfg.root 'models')) -and -not [Environment]::GetEnvironmentVariable('OMNIVOICE_CACHE_DIR', 'User')) {
        [Environment]::SetEnvironmentVariable('OMNIVOICE_CACHE_DIR', (Join-Path $cfg.root 'models'), 'User')
      }
      Ok "Vozes antigas em $($cfg.root) - o $Nome vai usar essa mesma pasta"
    } elseif (Test-Path $padrao) { Ok "Vozes antigas em $padrao - o $Nome usa essa pasta automaticamente" }
    else { Ok 'Nenhuma voz antiga encontrada (instalação nova)' }
  } catch { Aviso "Não consegui ler $loc ($_)" }
} elseif (Test-Path $padrao) { Ok "Vozes antigas em $padrao - o $Nome usa essa pasta automaticamente" }
else { Ok 'Nenhuma voz antiga encontrada (instalação nova)' }

# 9. Atalhos (Área de Trabalho e Menu Iniciar)
Passo 'Criando atalhos'
$shell = New-Object -ComObject WScript.Shell
$icone = Join-Path $Root 'electron\build\icons\icon.ico'
$vbs = Join-Path $Root 'INICIAR-WizardStudioVoice.vbs'
$menu = Join-Path ([Environment]::GetFolderPath('Programs')) "$Nome.lnk"
$desk = Join-Path ([Environment]::GetFolderPath('Desktop')) "$Nome.lnk"
foreach ($dest in @($desk, $menu)) {
  $s = $shell.CreateShortcut($dest)
  $s.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
  $s.Arguments = "`"$vbs`""
  $s.WorkingDirectory = $Root
  $s.IconLocation = "$icone,0"
  $s.Description = $Nome
  $s.Save()
}
# Atualiza o cache de icones do Windows (para o icone novo aparecer)
try { & "$env:WINDIR\System32\ie4uinit.exe" -show } catch { }
Ok 'Atalho criado na Área de Trabalho e no Menu Iniciar'

Write-Host "`n============================================" -ForegroundColor Green
Write-Host "   $Nome instalado!" -ForegroundColor Green
Write-Host "   Abra pelo atalho '$Nome' na Área de Trabalho." -ForegroundColor Green
Write-Host "   Se algo der errado, veja logs\ultimo-inicio.log" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
$abrir = Read-Host "`nAbrir o $Nome agora? (S/N)"
if ($abrir -match '^[sS]') { Start-Process (Join-Path $env:WINDIR 'System32\wscript.exe') -ArgumentList "`"$vbs`"" -WorkingDirectory $Root }
