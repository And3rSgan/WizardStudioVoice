import { Store } from '@tanstack/store';
import { useStore } from '@tanstack/react-store';
import type { GenerateResult } from '@/lib/api/types';
import { createObjectUrl, revokeObjectUrl } from '@/lib/audio/object-url';

export interface OutputState {
  result: GenerateResult | null;
  /** Object URL for `result.blob`, ready for `<audio src>` / waveform rendering. */
  objectUrl: string | null;
  /** The script that produced `result`. */
  text: string;
}

export const outputStore = new Store<OutputState>({ result: null, objectUrl: null, text: '' });

export function useLatestOutput(): OutputState {
  return useStore(outputStore);
}

export function setLatestOutput(result: GenerateResult, text: string): void {
  revokeObjectUrl(outputStore.state.objectUrl);
  outputStore.setState(() => ({ result, objectUrl: createObjectUrl(result.blob), text }));
}

// WizardStudioVoice: posicao (s) para onde o player da "Ultima tomada" deve
// pular assim que o proximo audio carregar (trecho que acabou de ser refeito).
let pendingSeek: number | null = null;
export function setPendingOutputSeek(seconds: number | null): void {
  pendingSeek = seconds;
}
export function takePendingOutputSeek(): number | null {
  const value = pendingSeek;
  pendingSeek = null;
  return value;
}

export function clearLatestOutput(): void {
  revokeObjectUrl(outputStore.state.objectUrl);
  outputStore.setState(() => ({ result: null, objectUrl: null, text: '' }));
}
