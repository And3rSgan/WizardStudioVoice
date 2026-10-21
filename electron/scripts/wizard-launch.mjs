// WizardStudioVoice - inicia o app ja compilado (sem servidor de desenvolvimento).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const electronRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(resolve(electronRoot, 'out', 'main', 'index.js'))) {
  console.error('[WizardStudioVoice] App ainda nao compilado. Rode INSTALAR-WizardStudioVoice.cmd primeiro.');
  process.exit(1);
}
const require = createRequire(import.meta.url);
// Electron 42+ baixa o binario na primeira chamada.
const electron = require('electron');
const env = { ...process.env };
delete env.ELECTRON_RENDERER_URL;
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { cwd: electronRoot, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
