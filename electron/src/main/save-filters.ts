import { extname } from 'node:path';

/** Downloads are already encoded; the picker must not suggest another container. */
export function saveFiltersFor(name: string, convertibleAudio = false) {
  const extension = extname(name).slice(1).toLowerCase();
  const all = { name: 'All files', extensions: ['*'] };
  // WizardStudioVoice: tomadas do app podem ser salvas em WAV ou MP3.
  if (convertibleAudio && (extension === 'wav' || extension === 'mp3')) {
    const wav = { name: 'WAV (qualidade máxima)', extensions: ['wav'] };
    const mp3 = { name: 'MP3 (arquivo menor)', extensions: ['mp3'] };
    return extension === 'mp3' ? [mp3, wav, all] : [wav, mp3, all];
  }
  return /^[a-z0-9]{1,8}$/.test(extension)
    ? [{ name: extension.toUpperCase(), extensions: [extension] }, all]
    : [all];
}

/** Tomada do app servida em /audio/<id>.wav (pode virar /audio/<id>.mp3). */
export function isConvertibleTake(source: string): boolean {
  try {
    return /\/audio\/[0-9a-f]{8}\.wav$/i.test(new URL(source).pathname);
  } catch {
    return false;
  }
}

/** URL a baixar para o arquivo escolhido: MP3 quando o nome termina em .mp3. */
export function sourceForSavedPath(source: string, savedPath: string): string {
  if (extname(savedPath).toLowerCase() !== '.mp3' || !isConvertibleTake(source)) return source;
  const url = new URL(source);
  url.pathname = url.pathname.replace(/\.wav$/i, '.mp3');
  return url.toString();
}
