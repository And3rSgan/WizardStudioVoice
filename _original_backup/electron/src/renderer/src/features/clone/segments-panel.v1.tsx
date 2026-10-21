// WizardStudioVoice: geracao por partes, no estilo do ElevenLabs Studio.
// O roteiro e dividido em partes; cada parte vira um audio separado (com
// progresso visivel) e, no final, tudo e juntado num unico arquivo.
import { useEffect, useRef, useState } from 'react';
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  ListIcon,
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
import { apiJson, audioUrl } from '@/lib/api/client';
import { useGenerateClone } from '@/hooks/use-generate';
import { useCloneSetting } from '@/lib/store/clone-settings';
import { splitScript, type SplitMode } from '@/lib/segments/split';
import {
  newSegmentId,
  segmentsStore,
  setSegmentsState,
  useSegments,
  type Segment,
} from '@/lib/store/segments';
import { cn } from '@/lib/utils';

const selectClass =
  'h-7 rounded-md border border-border/60 bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50';

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
            <select
              className={selectClass}
              value={splitBy}
              disabled={disabled}
              onChange={(event) => setSegmentsState({ splitBy: event.target.value as SplitMode })}
            >
              <option value="paragraph">Parágrafo</option>
              <option value="sentence">Frase</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-muted-foreground">
            Pausa entre parágrafos
            <select
              className={selectClass}
              value={paragraphGapMs}
              disabled={disabled}
              onChange={(event) => setSegmentsState({ paragraphGapMs: Number(event.target.value) })}
            >
              {[0, 200, 300, 450, 600, 800, 1000, 1500].map((ms) => (
                <option key={ms} value={ms}>
                  {ms === 0 ? 'nenhuma' : `${(ms / 1000).toLocaleString('pt-BR')} s`}
                </option>
              ))}
            </select>
          </label>
          {splitBy === 'sentence' && (
            <label className="flex items-center gap-1.5 text-muted-foreground">
              entre frases
              <select
                className={selectClass}
                value={sentenceGapMs}
                disabled={disabled}
                onChange={(event) => setSegmentsState({ sentenceGapMs: Number(event.target.value) })}
              >
                {[0, 100, 150, 250, 350, 500].map((ms) => (
                  <option key={ms} value={ms}>
                    {ms === 0 ? 'nenhuma' : `${(ms / 1000).toLocaleString('pt-BR')} s`}
                  </option>
                ))}
              </select>
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

/** Lista de partes com progresso, ouvir e refazer cada uma. */
export function SegmentsList() {
  const text = useCloneSetting('text');
  const segments = useSegments((s) => s.segments);
  const currentId = useSegments((s) => s.currentId);
  const splitBy = useSegments((s) => s.splitBy);
  const finalPath = useSegments((s) => s.finalPath);
  const { isGenerating, generateSegments, cancel, elapsedSeconds, error } = useGenerateClone();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

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
    setSegmentsState({ segments: [], finalPath: null, currentId: null });
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
          return (
            <li
              key={segment.id}
              id={`wsv-seg-${segment.id}`}
              className={cn(
                'group flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                active
                  ? 'border-primary/50 bg-primary/15'
                  : segment.status === 'error'
                    ? 'border-destructive/40 bg-destructive/5'
                    : 'border-transparent hover:border-border/50 hover:bg-muted/20',
                segment.paragraphEnd && 'mb-2',
              )}
            >
              <span className="mt-0.5 flex w-14 shrink-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                <StatusIcon segment={segment} />
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] leading-relaxed">{segment.text}</p>
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
