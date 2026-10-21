// WizardStudioVoice: estado da geracao por partes (estilo ElevenLabs Studio).
import { Store } from '@tanstack/store';
import { useStore } from '@tanstack/react-store';
import type { SplitMode } from '@/lib/segments/split';

export type SegmentStatus = 'pending' | 'generating' | 'done' | 'error';

export interface Segment {
  id: string;
  text: string;
  paragraphEnd: boolean;
  status: SegmentStatus;
  /** Configuracao (voz, idioma, ajustes + texto) usada para gerar esta parte. */
  key: string;
  audioPath: string | null;
  duration: number | null;
  error: string | null;
  /** Onde esta parte comeca no audio final (segundos). */
  start?: number | null;
  /** Voz e idioma usados (para reaproveitar a parte mesmo apos reabrir o app). */
  voice?: string;
  lang?: string;
}

export interface SegmentsState {
  enabled: boolean;
  splitBy: SplitMode;
  /** Pausa entre frases do mesmo paragrafo (ms). */
  sentenceGapMs: number;
  /** Pausa entre paragrafos (ms). */
  paragraphGapMs: number;
  view: 'text' | 'parts';
  segments: Segment[];
  currentId: string | null;
  /** Arquivo final juntado (bare filename em /audio/). */
  finalPath: string | null;
  /** Id da tomada final no historico; refazer partes atualiza esta mesma tomada. */
  finalId: string | null;
}

const STORAGE_KEY = 'wizardstudiovoice.segments.v1';

const DEFAULTS: SegmentsState = {
  enabled: true,
  splitBy: 'paragraph',
  sentenceGapMs: 150,
  paragraphGapMs: 450,
  view: 'text',
  segments: [],
  currentId: null,
  finalPath: null,
  finalId: null,
};

function load(): SegmentsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const saved = JSON.parse(raw) as Partial<SegmentsState>;
    const segments = Array.isArray(saved.segments)
      ? saved.segments.map((segment) => ({
          ...segment,
          // Uma geracao interrompida (app fechado) volta para a fila.
          status: segment.status === 'generating' ? ('pending' as const) : segment.status,
        }))
      : [];
    return { ...DEFAULTS, ...saved, segments, currentId: null };
  } catch {
    return DEFAULTS;
  }
}

export const segmentsStore = new Store<SegmentsState>(load());

let saveTimer: ReturnType<typeof setTimeout> | null = null;
segmentsStore.subscribe(() => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(segmentsStore.state));
    } catch {
      /* Sem armazenamento: o estado vale so para esta sessao. */
    }
  }, 300);
});

export function useSegments<T>(select: (state: SegmentsState) => T): T {
  return useStore(segmentsStore, select);
}

export function setSegmentsState(patch: Partial<SegmentsState>): void {
  segmentsStore.setState((state) => ({ ...state, ...patch }));
}

export function updateSegment(id: string, patch: Partial<Segment>): void {
  segmentsStore.setState((state) => ({
    ...state,
    segments: state.segments.map((segment) =>
      segment.id === id ? { ...segment, ...patch } : segment,
    ),
  }));
}

/**
 * Chave de reaproveitamento: so voz + idioma + texto. Ajustes que o app muda
 * sozinho ao abrir (passos, perfil de hardware...) nao invalidam as partes;
 * para refazer tudo com ajustes novos ha o botao "Refazer todas".
 */
export function reuseKey(voice: string, lang: string, text: string): string {
  return `${voice}\u0001${lang}\u0001${text}`;
}

export function segmentReuseKey(segment: Segment): string | null {
  if (segment.voice !== undefined && segment.lang !== undefined)
    return reuseKey(segment.voice, segment.lang, segment.text);
  try {
    // Partes antigas: a chave completa comecava com um JSON [voz, motor, idioma, ...].
    const settings = JSON.parse(segment.key.split('\u0000')[0] ?? '') as unknown[];
    return reuseKey(String(settings[0]), String(settings[2]), segment.text);
  } catch {
    return null;
  }
}

export function newSegmentId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
