// WizardStudioVoice: geracao por partes, no estilo do ElevenLabs Studio.
// O roteiro e dividido em partes; cada parte vira um audio separado (com
// progresso visivel) e, no final, tudo e juntado num unico arquivo.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  ListIcon,
  LocateFixedIcon,
  PencilIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  ScissorsIcon,
  SquareIcon,
  Trash2Icon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { ApiError, apiFetch, apiJson, audioUrl } from '@/lib/api/client';
import { requestPlaybackSeek, usePlaybackTime } from '@/lib/audio/playback-clock';
import { activePlaybackSource, stopActivePlayback, usePlaybackSource } from '@/lib/audio/playback';
import { outputStore, setLatestOutput, useLatestOutput } from '@/lib/store/output';
import { useGenerateClone } from '@/hooks/use-generate';
import { cloneSettingsStore, setCloneSetting, useCloneSetting } from '@/lib/store/clone-settings';
import { splitScript, type SplitMode } from '@/lib/segments/split';
import {
  newSegmentId,
  segmentsStore,
  setSegmentsState,
  useSegments,
  updateSegment,
  type Segment,
} from '@/lib/store/segments';
import { cn } from '@/lib/utils';

/** Seletor com o visual escuro do app (o <select> nativo abria branco). */
function MiniSelect({
  value,
  options,
  onChange,
  disabled,
  label,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <Select
      items={options}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next != null) onChange(String(next));
      }}
    >
      <SelectTrigger size="sm" aria-label={label} className="min-w-24 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} className="text-xs">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const gapLabel = (ms: number) => (ms === 0 ? 'nenhuma' : `${(ms / 1000).toLocaleString('pt-BR')} s`);
const PARAGRAPH_GAPS = [0, 200, 300, 450, 600, 800, 1000, 1500].map((ms) => ({
  value: String(ms),
  label: gapLabel(ms),
}));
const SENTENCE_GAPS = [0, 100, 150, 250, 350, 500].map((ms) => ({
  value: String(ms),
  label: gapLabel(ms),
}));
const SPLIT_OPTIONS = [
  { value: 'paragraph', label: 'Parágrafo' },
  { value: 'sentence', label: 'Frase' },
];

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** Barra acima do roteiro: liga/desliga o modo e escolhe como dividir. */
export function SegmentsToolbar({ disabled }: { disabled?: boolean }) {
  const enabled = useSegments((s) => s.enabled);
  const view = useSegments((s) => s.view);
  const splitBy = useSegments((s) => s.splitBy);
  const paragraphGapMs = useSegments((s) => s.paragraphGapMs);
  const sentenceGapMs = useSegments((s) => s.sentenceGapMs);
  const count = useSegments((s) => s.segments.length);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-xs">
      <label className="flex cursor-pointer items-center gap-2 font-medium">
        <Switch
          checked={enabled}
          disabled={disabled}
          onCheckedChange={(checked) => setSegmentsState({ enabled: Boolean(checked) })}
        />
        Gerar por partes
      </label>
      {enabled && (
        <>
          <div className="flex overflow-hidden rounded-md border border-border/60">
            {(['text', 'parts'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setSegmentsState({ view: value })}
                className={cn(
                  'px-2.5 py-1 transition-colors',
                  view === value
                    ? 'bg-primary/20 text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {value === 'text' ? 'Texto' : `Partes${count ? ` (${count})` : ''}`}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-muted-foreground">
            Dividir por
            <MiniSelect
              label="Dividir por"
              value={splitBy}
              options={SPLIT_OPTIONS}
              disabled={disabled}
              onChange={(value) => setSegmentsState({ splitBy: value as SplitMode })}
            />
          </label>
          <label className="flex items-center gap-1.5 text-muted-foreground">
            Pausa entre parágrafos
            <MiniSelect
              label="Pausa entre parágrafos"
              value={String(paragraphGapMs)}
              options={PARAGRAPH_GAPS}
              disabled={disabled}
              onChange={(value) => setSegmentsState({ paragraphGapMs: Number(value), finalPath: null })}
            />
          </label>
          {splitBy === 'sentence' && (
            <label className="flex items-center gap-1.5 text-muted-foreground">
              entre frases
              <MiniSelect
                label="Pausa entre frases"
                value={String(sentenceGapMs)}
                options={SENTENCE_GAPS}
                disabled={disabled}
                onChange={(value) => setSegmentsState({ sentenceGapMs: Number(value), finalPath: null })}
              />
            </label>
          )}
        </>
      )}
    </div>
  );
}

function StatusIcon({ segment }: { segment: Segment }) {
  if (segment.status === 'generating') return <Spinner className="size-4 text-primary" />;
  if (segment.status === 'done') return <CircleCheckIcon className="size-4 text-emerald-400" />;
  if (segment.status === 'error') return <CircleAlertIcon className="size-4 text-destructive" />;
  return <CircleDashedIcon className="size-4 text-muted-foreground/60" />;
}

/**
 * Ao abrir o app, devolve o audio final da geracao por partes para o player da
 * "Ultima tomada" (antes ele sumia ao fechar o app).
 */
let restoreTried = false;
export function useRestoreSegmentsOutput(): void {
  useEffect(() => {
    if (restoreTried) return;
    restoreTried = true;
    const { enabled, finalPath, finalId, segments } = segmentsStore.state;
    if (!enabled || !finalPath || outputStore.state.result) return;
    void (async () => {
      try {
        const response = await apiFetch('/audio/' + encodeURIComponent(finalPath));
        const blob = await response.blob();
        // Algo mais novo ja ocupou o player enquanto carregava: nao sobrescreve.
        if (outputStore.state.result || segmentsStore.state.finalPath !== finalPath) return;
        const last = segments.at(-1);
        setLatestOutput(
          {
            blob,
            id: finalId,
            audioPath: finalPath,
            durationSeconds:
              last?.start != null && last.duration != null ? last.start + last.duration : null,
            genTimeSeconds: null,
            seed: null,
            routing: null,
            dropped: null,
          },
          cloneSettingsStore.state.text,
        );
      } catch (error) {
        // O arquivo final foi apagado (ex.: tomada removida do historico).
        if (error instanceof ApiError && error.status === 404) setSegmentsState({ finalPath: null });
      }
    })();
  }, []);
}

/** Indice da parte que esta tocando no audio final (-1 se nenhuma). */
function partAt(starts: (number | null | undefined)[], time: number): number {
  let found = -1;
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    if (start == null) continue;
    if (start <= time + 0.05) found = index;
    else break;
  }
  return found;
}

/**
 * Texto da parte que esta tocando: as palavras ja faladas acendem conforme o
 * audio avanca (estimativa proporcional ao tamanho das palavras).
 */
function SpokenText({ segment }: { segment: Segment }) {
  const words = useMemo(() => {
    let end = 0;
    return (segment.text.match(/\S+\s*/g) ?? [segment.text]).map((text) => {
      end += text.trim().length;
      return { text, end };
    });
  }, [segment.text]);
  const totalChars = words.at(-1)?.end || 1;
  const current = usePlaybackTime('output', (time) => {
    const duration = segment.duration ?? 0;
    if (!duration || segment.start == null) return -1;
    const fraction = Math.min(1, Math.max(0, (time - segment.start) / duration));
    const chars = fraction * totalChars;
    const index = words.findIndex((word) => word.end > chars);
    return index < 0 ? words.length : index;
  });
  return (
    <>
      {words.map((word, index) => (
        <span
          key={index}
          className={cn(
            'transition-colors duration-150',
            index < current
              ? 'text-foreground'
              : index === current
                ? 'rounded-sm bg-primary/25 text-foreground'
                : 'text-foreground/45',
          )}
        >
          {word.text}
        </span>
      ))}
    </>
  );
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Troca o texto de uma parte dentro do roteiro completo (aba Texto),
 * preservando a formatacao do resto. Retorna null se nao achar o trecho.
 */
function replaceInScript(script: string, oldText: string, newText: string, occurrence: number) {
  const words = oldText.trim().split(/\s+/).map(escapeRegExp);
  if (!words.length || !words[0]) return null;
  const pattern = new RegExp(words.join('\\s+'), 'g');
  let seen = 0;
  for (let match = pattern.exec(script); match; match = pattern.exec(script)) {
    if (seen === occurrence)
      return script.slice(0, match.index) + newText.trim() + script.slice(match.index + match[0].length);
    seen += 1;
  }
  return null;
}

/** Lista de partes com progresso, ouvir, editar e refazer cada uma. */
export function SegmentsList() {
  const text = useCloneSetting('text');
  const segments = useSegments((s) => s.segments);
  const currentId = useSegments((s) => s.currentId);
  const splitBy = useSegments((s) => s.splitBy);
  const finalPath = useSegments((s) => s.finalPath);
  const { isGenerating, generateSegments, cancel, elapsedSeconds, error } = useGenerateClone();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [follow, setFollow] = useState(true);

  // Acompanhar o player da "Ultima tomada": qual parte esta sendo falada.
  const output = useLatestOutput();
  const tracking = Boolean(finalPath && output.result?.audioPath === finalPath);
  const starts = useMemo(() => segments.map((segment) => segment.start), [segments]);
  const outputPlaying = usePlaybackSource() === 'output';
  const playingIndex = usePlaybackTime('output', (time) =>
    tracking && (time > 0 || outputPlaying) ? partAt(starts, time) : -1,
  );
  const playingSegmentId = playingIndex >= 0 ? segments[playingIndex]?.id : undefined;
  useEffect(() => {
    if (!follow || !outputPlaying || !playingSegmentId || editingId) return;
    document
      .getElementById(`wsv-seg-${playingSegmentId}`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [playingSegmentId, follow, outputPlaying, editingId]);

  const startEdit = (segment: Segment) => {
    if (isGenerating) return;
    // Viu um erro ouvindo? Pausa o player para editar com calma.
    if (activePlaybackSource() === 'output') stopActivePlayback();
    setEditingId(segment.id);
    setDraft(segment.text);
  };

  const saveEdit = (segment: Segment, regenerate: boolean) => {
    const next = draft.replace(/\s*\n+\s*/g, ' ').trim();
    setEditingId(null);
    if (!next) {
      toast.error('A parte não pode ficar vazia.');
      return;
    }
    if (next === segment.text) {
      if (regenerate) void generateSegments({ only: [segment.id] });
      return;
    }
    const all = segmentsStore.state.segments;
    const index = all.findIndex((item) => item.id === segment.id);
    const occurrence = all.slice(0, index).filter((item) => item.text === segment.text).length;
    const script = cloneSettingsStore.state.text;
    const updated = replaceInScript(script, segment.text, next, occurrence);
    if (updated == null) {
      toast.error('Não achei esse trecho no texto. Ele foi mudado na aba Texto? Gere de novo antes de editar.');
      return;
    }
    setCloneSetting('text', updated);
    updateSegment(segment.id, { text: next, status: 'pending', duration: null, error: null });
    setSegmentsState({ finalPath: null });
    if (regenerate) void generateSegments();
  };

  const onEditKey = (event: KeyboardEvent<HTMLTextAreaElement>, segment: Segment) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setEditingId(null);
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.stopPropagation();
      saveEdit(segment, true);
    }
  };

  useEffect(() => {
    if (!currentId) return;
    document
      .getElementById(`wsv-seg-${currentId}`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [currentId]);

  useEffect(
    () => () => {
      audioRef.current?.pause();
    },
    [],
  );

  const play = (segment: Segment) => {
    if (!segment.audioPath) return;
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.onended = () => setPlayingId(null);
    }
    const audio = audioRef.current;
    if (playingId === segment.id) {
      audio.pause();
      setPlayingId(null);
      return;
    }
    stopActivePlayback();
    audio.src = audioUrl(segment.audioPath);
    void audio.play().catch(() => setPlayingId(null));
    setPlayingId(segment.id);
  };

  const done = segments.filter((s) => s.status === 'done').length;
  const failed = segments.filter((s) => s.status === 'error').length;
  const total = segments.length;
  const seconds = segments.reduce((sum, s) => sum + (s.duration ?? 0), 0);
  const percent = total ? Math.round((done / total) * 100) : 0;
  const allDone = total > 0 && done === total;

  const preview = () =>
    setSegmentsState({
      finalPath: null,
      segments: splitScript(text, splitBy).map((part) => ({
        id: newSegmentId(),
        text: part.text,
        paragraphEnd: part.paragraphEnd,
        status: 'pending' as const,
        key: '',
        audioPath: null,
        duration: null,
        error: null,
      })),
    });

  const clear = () => {
    const files = segmentsStore.state.segments
      .map((s) => s.audioPath)
      .filter((path): path is string => Boolean(path));
    if (files.length)
      void apiJson('/segments/delete', {
        method: 'POST',
        body: JSON.stringify({ files }),
      }).catch(() => {});
    audioRef.current?.pause();
    setPlayingId(null);
    setSegmentsState({ segments: [], finalPath: null, finalId: null, currentId: null });
  };

  if (!total)
    return (
      <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
        <ListIcon className="size-6" />
        <p className="max-w-md">
          Clique em <strong className="text-foreground">Sintetizar áudio</strong> para dividir o
          texto em partes e gerar uma por uma. No final, tudo vira um único arquivo.
        </p>
        <Button variant="outline" size="sm" disabled={!text.trim()} onClick={preview}>
          <ScissorsIcon data-icon="inline-start" />
          Ver como vai ficar dividido
        </Button>
      </div>
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="sticky top-0 z-[1] flex flex-col gap-2 rounded-lg border border-border/50 bg-background/95 px-3 py-2.5 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-medium">
            {done} de {total} partes prontas
            {failed ? <span className="text-destructive"> · {failed} com erro</span> : null}
            <span className="text-muted-foreground"> · {formatClock(seconds)} de áudio</span>
            {isGenerating && (
              <span className="text-muted-foreground"> · {formatClock(elapsedSeconds)} gerando</span>
            )}
          </span>
          <div className="flex items-center gap-1">
            {tracking && !isGenerating && (
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={follow}
                title="Rolar a lista junto com o player lá embaixo"
                className={cn(follow ? 'text-primary' : 'text-muted-foreground')}
                onClick={() => setFollow((value) => !value)}
              >
                <LocateFixedIcon data-icon="inline-start" />
                {follow ? 'Acompanhando leitura' : 'Acompanhar leitura'}
              </Button>
            )}
            {isGenerating ? (
              <Button variant="ghost" size="sm" onClick={() => cancel()}>
                <SquareIcon data-icon="inline-start" />
                Parar
              </Button>
            ) : (
              <>
                {allDone && !finalPath && (
                  <Button variant="outline" size="sm" onClick={() => void generateSegments()}>
                    Juntar num arquivo
                  </Button>
                )}
                {!allDone && (
                  <Button variant="outline" size="sm" onClick={() => void generateSegments()}>
                    {done ? 'Continuar gerando' : 'Gerar partes'}
                  </Button>
                )}
                {done > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Gerar todas as partes de novo (ex.: depois de mudar a qualidade)"
                    onClick={() => {
                      if (window.confirm('Gerar TODAS as partes de novo? As prontas serão substituídas.'))
                        void generateSegments({ all: true });
                    }}
                  >
                    <RotateCcwIcon data-icon="inline-start" />
                    Refazer todas
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={clear} title="Apagar todas as partes">
                  <Trash2Icon data-icon="inline-start" />
                  Limpar
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
        {error && !isGenerating && <p className="text-xs text-destructive">{error}</p>}
        {finalPath && allDone && !isGenerating && (
          <p className="text-xs text-emerald-400">
            Arquivo final pronto em “Última tomada”, embaixo. Use “Salvar como…” para baixar.
          </p>
        )}
      </div>

      <ol className="flex flex-col gap-1.5">
        {segments.map((segment, index) => {
          const active = segment.id === currentId;
          const playing = index === playingIndex && !active;
          return (
            <li
              key={segment.id}
              id={`wsv-seg-${segment.id}`}
              className={cn(
                'group flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                active
                  ? 'border-primary/50 bg-primary/15'
                  : playing
                    ? 'border-primary/40 bg-primary/10 shadow-[inset_3px_0_0_var(--primary)]'
                    : segment.status === 'error'
                    ? 'border-destructive/40 bg-destructive/5'
                    : 'border-transparent hover:border-border/50 hover:bg-muted/20',
                segment.paragraphEnd && 'mb-2',
              )}
            >
              <button
                type="button"
                disabled={!finalPath || segment.start == null}
                title={
                  finalPath && segment.start != null
                    ? 'Levar o player lá embaixo para este trecho'
                    : undefined
                }
                onClick={() => {
                  if (segment.start != null) requestPlaybackSeek('output', segment.start);
                }}
                className="mt-0.5 flex w-14 shrink-0 items-center gap-1.5 rounded text-left text-xs text-muted-foreground tabular-nums enabled:hover:text-foreground disabled:cursor-default"
              >
                <StatusIcon segment={segment} />
                {index + 1}
              </button>
              <div className="min-w-0 flex-1">
                {editingId === segment.id ? (
                  <div className="flex flex-col gap-2">
                    <Textarea
                      autoFocus
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => onEditKey(event, segment)}
                      onFocus={(event) => {
                        const end = event.currentTarget.value.length;
                        event.currentTarget.setSelectionRange(end, end);
                      }}
                      rows={Math.min(8, Math.max(2, Math.ceil(draft.length / 80)))}
                      className="min-h-0 resize-y text-[15px] leading-relaxed"
                    />
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button size="sm" onClick={() => saveEdit(segment, true)}>
                        <RotateCcwIcon data-icon="inline-start" />
                        Salvar e regenerar
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => saveEdit(segment, false)}>
                        Só salvar
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                        Cancelar
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        Ctrl+Enter salva e regenera · Esc cancela
                      </span>
                    </div>
                  </div>
                ) : (
                  <p
                    className={cn(
                      'rounded text-[15px] leading-relaxed',
                      !isGenerating && 'cursor-text hover:bg-muted/30',
                    )}
                    title={isGenerating ? undefined : 'Clique para editar'}
                    onClick={() => startEdit(segment)}
                  >
                    {playing ? <SpokenText segment={segment} /> : segment.text}
                  </p>
                )}
                {segment.error && (
                  <p className="mt-1 text-xs text-destructive">{segment.error}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                {segment.duration != null && (
                  <span className="mr-1 text-xs text-muted-foreground tabular-nums">
                    {formatClock(segment.duration)}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={isGenerating || editingId === segment.id}
                  aria-label="Editar esta parte"
                  title="Editar esta parte"
                  onClick={() => startEdit(segment)}
                >
                  <PencilIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={!segment.audioPath}
                  aria-label="Ouvir esta parte"
                  title="Ouvir esta parte"
                  onClick={() => play(segment)}
                >
                  {playingId === segment.id ? <PauseIcon /> : <PlayIcon />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={isGenerating}
                  aria-label="Refazer esta parte"
                  title="Refazer esta parte (e juntar de novo)"
                  onClick={() => void generateSegments({ only: [segment.id] })}
                >
                  <RotateCcwIcon />
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
