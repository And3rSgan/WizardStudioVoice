import { acquireSynthesis } from '@/lib/synthesis-lock';
import { useCloneInputsReadiness } from './use-clone-readiness';
import type { CloneBlocker } from '@/lib/clone-readiness';
import { setWorkspace } from '@/lib/store/workspace';
import { rememberTake } from '@/lib/store/takes';
import {
  createContext,
  createElement,
  useContext,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { throttle } from '@tanstack/react-pacer';
import { toast } from 'sonner';
import { ApiError, apiFetch, apiJson, describeError, isAbortError } from '@/lib/api/client';
import { splitScript } from '@/lib/segments/split';
import {
  newSegmentId,
  reuseKey,
  segmentReuseKey,
  segmentsStore,
  setSegmentsState,
  updateSegment,
  type Segment,
} from '@/lib/store/segments';
import { generateClone, sanitizeInstruct } from '@/lib/api/generate';
import type {
  DesignRecipe,
  EnginesResponse,
  GenerateResult,
  InstructVocabulary,
  Profile,
} from '@/lib/api/types';
import { effectiveSamplingSteps } from '@/lib/audio/quality';
import { cachedTtsLanguagesSupported } from '@/lib/language-options';
import { tr } from '@/lib/i18n-text';
import { queryKeys } from '@/lib/query';
import { cloneSettingsStore } from '@/lib/store/clone-settings';
import { setLatestOutput, setPendingOutputSeek } from '@/lib/store/output';
import { referenceStore } from '@/lib/store/reference';
import { beginAppActivity } from '@/lib/app-activity';
import { useTtsReadiness } from './use-tts-readiness';
import { useEngines } from './use-engines';
import { recordActionBreadcrumb } from '@/lib/report-breadcrumb';
import { announceDroppedSpeech } from '@/lib/dropped-speech';

const TIMER_TICK_MS = 100;
const PROGRESS_THROTTLE_MS = 100;
const MODEL_NOT_DOWNLOADED = 'model_not_downloaded';

// One synthesis at a time across every mounted hook instance: the backend
// serialises on the GPU anyway, and a second request would only queue behind
// the first while the UI shows two spinners.

// The routing notice fires once per distinct status per session — a batch of
// renders on a CPU-fallback box must not toast on every take.
let lastRoutingStatus: string | null = null;

export interface DesignGenerateInput {
  text: string;
  instruct: string;
  /** Omitted to use the linked profile's own (possibly unset) seed. */
  seed?: number;
  language?: string;
  profileId?: string | null;
  /** Stored with the take so reopening it rebuilds the same draft (#2389). */
  recipe?: DesignRecipe;
}

/**
 * `design`: the engine can't design and there is no saved sample to clone.
 * `cloning`: a saved sample would be re-rendered, but the engine ignores
 * reference audio, so it would speak with a preset voice instead.
 */
type DesignBlocker = 'engine' | 'loading' | 'design' | 'cloning' | null;

/**
 * True when re-rendering this linked design profile clones its saved sample
 * (the locked take, else the rendered sample), so the engine designs nothing.
 * Mirrors /generate's profile conditioning for an undiverged design request.
 */
export function clonesSavedSample(profile: Profile | null | undefined): boolean {
  return Boolean(
    profile && ((profile.is_locked && profile.locked_audio_path) || profile.ref_audio_path),
  );
}

export interface UseGenerateClone {
  generateDesign(input: DesignGenerateInput): Promise<void>;
  generate(): Promise<void>;
  /** WizardStudioVoice: gera o roteiro por partes; `only` forca refazer essas partes. */
  generateSegments(opts?: { only?: string[]; all?: boolean }): Promise<void>;
  cancel(): void;
  isGenerating: boolean;
  elapsedSeconds: number;
  /** 0..100 while the WAV body streams in; null when unknown. */
  progress: number | null;
  stage: 'preparing' | 'loading' | 'generating' | 'receiving';
  modelStage: 'importing' | 'loading_weights' | 'loading_asr' | 'compiling' | null;
  /** 0..100 reported while model weights or runtime are loading. */
  modelProgress: number | null;
  error: string | null;
  clearError(): void;
  canGenerate: boolean;
  canGenerateDesign: boolean;
  /** `design`: the active engine needs a reference clip, so it can't design. */
  designBlocker: DesignBlocker;
  /**
   * The blocker for re-rendering `profile`: cloning its saved sample isn't
   * design, but it does need an engine that reads reference audio.
   */
  designBlockerFor(profile: Profile | null | undefined): DesignBlocker;
  cloneBlocker: CloneBlocker;
  /** How the active engine reads `instruct`: OmniVoice tags or as written (#2389). */
  instructVocabulary: InstructVocabulary;
}

function isModelNotDownloaded(err: unknown): boolean {
  if (!(err instanceof ApiError) || !err.payload) return false;
  const detail = err.payload.detail;
  return (
    typeof detail === 'object' &&
    detail !== null &&
    (detail as { error?: unknown }).error === MODEL_NOT_DOWNLOADED
  );
}

function announceInstructWarnings(free: string): string {
  const { instruct, unsupported, duplicates, conflicts } = sanitizeInstruct(free);
  if (unsupported.length) {
    toast.warning(tr('tts_errors.ignored_unsupported', { items: unsupported.join(', ') }));
  }
  if (duplicates.length) {
    toast.warning(tr('tts_errors.ignored_duplicate', { items: duplicates.join(', ') }));
  }
  if (conflicts.length) {
    toast.warning(tr('tts_errors.ignored_conflict', { items: conflicts.join(', ') }));
  }
  return instruct;
}

function announceResultNotices(result: GenerateResult): void {
  announceDroppedSpeech(result.dropped);
  // The backend only sets the routing headers on cpu_fallback / accelerated-
  // with-caveat, so their presence is the signal.
  if (result.routing && result.routing.status !== lastRoutingStatus) {
    lastRoutingStatus = result.routing.status;
    const { status, reason } = result.routing;
    if (status === 'cpu_fallback') {
      toast.info(tr('tts.routingFallback', { reason }));
    } else if (status === 'accelerated' && reason) {
      toast.warning(tr('tts.routingCaveat', { reason }));
    }
  }
}

function useGenerateController(): UseGenerateClone {
  const queryClient = useQueryClient();
  const inputBlocker = useCloneInputsReadiness();
  const ttsBlocker = useTtsReadiness();
  const cloneEngineBlocker = useTtsReadiness('clone');
  const blocker = cloneEngineBlocker ?? inputBlocker;
  const activeTts = useEngines().activeTts;
  const instructVocabulary = activeTts?.instruct_vocabulary ?? 'tags';
  // An engine that declares it can't design would only fail inside the
  // engine (and /generate refuses it); say so before anything starts.
  const designBlocker: DesignBlocker =
    activeTts?.supports_voice_design === false ? 'design' : ttsBlocker;
  const cannotClone = activeTts?.supports_cloning === false;
  const designBlockerFor = useCallback(
    (profile: Profile | null | undefined): DesignBlocker => {
      if (!clonesSavedSample(profile)) return designBlocker;
      // /generate refuses a saved sample on an engine that ignores it.
      return ttsBlocker ?? (cannotClone ? 'cloning' : null);
    },
    [cannotClone, designBlocker, ttsBlocker],
  );
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [progress, setProgress] = useState<number | null>(null);
  const [stage, setStage] = useState<UseGenerateClone['stage']>('preparing');
  const [modelStage, setModelStage] = useState<UseGenerateClone['modelStage']>(null);
  const [modelProgress, setModelProgress] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const reportModeRef = useRef<'clone' | 'design' | null>(null);
  const cancelledRef = useRef(false);
  const activeRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Trailing-edge throttle can fire after completion; `activeRef` gates it so
  // a stale 100% never lands on an idle form.
  const onProgress = useMemo(
    () =>
      throttle(
        (pct: number | null) => {
          if (activeRef.current) {
            setProgress(pct);
            setStage('receiving');
          }
        },
        { wait: PROGRESS_THROTTLE_MS, leading: true, trailing: true },
      ),
    [],
  );

  useEffect(() => {
    if (!isGenerating) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const model = await apiJson<{
          status: string;
          loading?: boolean;
          sub_stage?: string;
          progress?: number;
          checkpoint?: string | null;
          detail?: string | null;
          error?: string | null;
        }>('/model/status', { signal: controller.signal });
        if (!controller.signal.aborted) {
          // The composer and Engine Ready panel describe the same runtime.
          // Publish this faster generation-time sample instead of making the
          // sidebar wait for its slower idle poll.
          queryClient.setQueryData(['sidebar-model-status'], model);
          const nextModelStage = [
            'importing',
            'loading_weights',
            'loading_asr',
            'compiling',
          ].includes(model.sub_stage ?? '')
            ? (model.sub_stage as UseGenerateClone['modelStage'])
            : null;
          setModelStage(nextModelStage);
          setModelProgress(
            typeof model.progress === 'number' ? Math.max(0, Math.min(100, model.progress)) : null,
          );
          setStage((current) =>
            current === 'receiving'
              ? current
              : model.loading || model.status === 'loading'
                ? 'loading'
                : 'generating',
          );
        }
      } catch {
        /* Status is optional; never interrupt the generation request. */
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 750);
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [isGenerating, queryClient]);

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
      abortRef.current?.abort();
    },
    [],
  );

  const generate = useCallback(
    async (design?: DesignGenerateInput) => {
      const settings = cloneSettingsStore.state;
      const reference = referenceStore.state;
      if (
        !cachedTtsLanguagesSupported(queryClient, design ? 'tts' : 'clone', [
          design?.language ?? settings.language,
        ])
      ) {
        setError(tr('languagePicker.chooseSupported'));
        return;
      }
      if (
        design
          ? designBlockerFor(
              design.profileId
                ? queryClient
                    .getQueryData<Profile[]>(queryKeys.profiles)
                    ?.find((profile) => profile.id === design.profileId)
                : null,
            ) || !design.text.trim()
          : blocker ||
            !settings.text.trim() ||
            (!settings.selectedProfileId && !reference.file?.size)
      ) {
        if (blocker === 'reference') setWorkspace({ panel: 'voice' });
        return;
      }
      const release = acquireSynthesis();
      if (!release) {
        toast.info(tr('tts_errors.generation_in_progress'));
        return;
      }
      const finishActivity = beginAppActivity('synthesis');
      const reportMode = design ? 'design' : 'clone';
      reportModeRef.current = reportMode;
      recordActionBreadcrumb(`generate:${reportMode}:start`);

      activeRef.current = true;
      cancelledRef.current = false;
      setError(null);
      setIsGenerating(true);
      setElapsedSeconds(0);
      setProgress(null);
      setStage('preparing');
      setModelStage(null);
      setModelProgress(null);
      const startedAt = Date.now();
      timerRef.current = setInterval(() => {
        setElapsedSeconds(Math.round((Date.now() - startedAt) / TIMER_TICK_MS) / 10);
      }, TIMER_TICK_MS);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const free = design?.instruct ?? settings.instruct;
        // Only OmniVoice's closed tag set needs reducing; other engines read
        // the description natively and would lose whatever the sanitizer drops.
        const instruct = !free.trim()
          ? ''
          : instructVocabulary === 'freeform'
            ? free.trim()
            : announceInstructWarnings(free);
        const input = {
          text: design?.text ?? settings.text,
          seed: design?.seed,
          language: design?.language ?? settings.language,
          profileId: design ? (design.profileId ?? null) : settings.selectedProfileId,
          refAudio: design || settings.selectedProfileId ? null : reference.file,
          refText: design ? undefined : settings.refText,
          instruct,
          instructVocabulary,
          designRecipe: design?.recipe,
          steps: effectiveSamplingSteps(
            settings.steps,
            queryClient.getQueryData<EnginesResponse>(queryKeys.engines)?.tts?.active,
          ),
          wavBits: settings.wavBits,
          effectPreset: settings.effectPreset,
          presetVoice: activeTts?.preset_voices?.includes(settings.presetVoice)
            ? settings.presetVoice
            : undefined,
          cfg: settings.cfg,
          speed: settings.speed,
          tShift: settings.tShift,
          posTemp: settings.posTemp,
          classTemp: settings.classTemp,
          layerPenalty: settings.layerPenalty,
          denoise: settings.denoise,
          postprocess: settings.postprocess,
          duration: settings.duration,
        };
        const result = await generateClone(input, {
          signal: controller.signal,
          onProgress,
        });
        announceResultNotices(result);
        setLatestOutput(result, design?.text ?? settings.text);
        recordActionBreadcrumb(`generate:${reportMode}:complete`);
        toast.success(tr('tts.generationComplete'), { position: 'top-right' });
        if (!design) rememberTake(result.id, settings);
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.history }),
          queryClient.invalidateQueries({ queryKey: ['loaded-models'] }),
          queryClient.invalidateQueries({ queryKey: queryKeys.engines }),
        ]).catch(() => {});
      } catch (err) {
        if (!cancelledRef.current) {
          recordActionBreadcrumb(`generate:${reportMode}:error`);
          setError(
            isAbortError(err)
              ? tr('tts_errors.timeout')
              : isModelNotDownloaded(err)
                ? tr('tts_errors.model_not_downloaded')
                : describeError(err),
          );
        }
      } finally {
        finishActivity();
        release();
        activeRef.current = false;
        abortRef.current = null;
        reportModeRef.current = null;
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        setIsGenerating(false);
        setProgress(null);
        setModelStage(null);
        setModelProgress(null);
        void queryClient
          .invalidateQueries({
            queryKey: ['sidebar-model-status'],
          })
          .catch(() => {});
      }
    },
    [queryClient, onProgress, blocker, designBlockerFor, instructVocabulary, activeTts],
  );

  // ── WizardStudioVoice: geracao por partes ────────────────────────────────
  const generateSegments = useCallback(
    async (opts: { only?: string[]; all?: boolean } = {}) => {
      const settings = cloneSettingsStore.state;
      const reference = referenceStore.state;
      if (!cachedTtsLanguagesSupported(queryClient, 'clone', [settings.language])) {
        setError(tr('languagePicker.chooseSupported'));
        return;
      }
      if (
        blocker ||
        !settings.text.trim() ||
        (!settings.selectedProfileId && !reference.file?.size)
      ) {
        if (blocker === 'reference') setWorkspace({ panel: 'voice' });
        return;
      }
      const release = acquireSynthesis();
      if (!release) {
        toast.info(tr('tts_errors.generation_in_progress'));
        return;
      }
      const finishActivity = beginAppActivity('synthesis');
      reportModeRef.current = 'clone';
      recordActionBreadcrumb('generate:clone:start');
      activeRef.current = true;
      cancelledRef.current = false;
      setError(null);
      setIsGenerating(true);
      setElapsedSeconds(0);
      setProgress(0);
      setStage('preparing');
      setModelStage(null);
      setModelProgress(null);
      const startedAt = Date.now();
      timerRef.current = setInterval(() => {
        setElapsedSeconds(Math.round((Date.now() - startedAt) / TIMER_TICK_MS) / 10);
      }, TIMER_TICK_MS);
      const controller = new AbortController();
      abortRef.current = controller;
      const discarded: string[] = [];
      try {
        const free = settings.instruct;
        const instruct = !free.trim()
          ? ''
          : instructVocabulary === 'freeform'
            ? free.trim()
            : announceInstructWarnings(free);
        const base = {
          text: '',
          language: settings.language,
          profileId: settings.selectedProfileId,
          refAudio: settings.selectedProfileId ? null : reference.file,
          refText: settings.refText,
          instruct,
          instructVocabulary,
          steps: effectiveSamplingSteps(
            settings.steps,
            queryClient.getQueryData<EnginesResponse>(queryKeys.engines)?.tts?.active,
          ),
          wavBits: settings.wavBits,
          effectPreset: settings.effectPreset,
          presetVoice: activeTts?.preset_voices?.includes(settings.presetVoice)
            ? settings.presetVoice
            : undefined,
          cfg: settings.cfg,
          speed: settings.speed,
          tShift: settings.tShift,
          posTemp: settings.posTemp,
          classTemp: settings.classTemp,
          layerPenalty: settings.layerPenalty,
          denoise: settings.denoise,
          postprocess: settings.postprocess,
          duration: '',
          segment: true,
        };
        const voiceKey =
          settings.selectedProfileId ??
          `upload:${reference.file?.name}:${reference.file?.size}:${reference.file?.lastModified}`;
        const keyBase = JSON.stringify([
          voiceKey,
          activeTts?.id ?? '',
          settings.language,
          instruct,
          base.steps,
          base.wavBits,
          base.effectPreset,
          base.presetVoice ?? '',
          base.cfg,
          base.speed,
          base.tShift,
          base.posTemp,
          base.classTemp,
          base.layerPenalty,
          base.denoise,
          base.postprocess,
          settings.refText,
        ]);

        // 1. Divide o texto e reaproveita as partes que ja estao prontas.
        const previous = segmentsStore.state;
        const pool = new Map<string, Segment[]>();
        for (const segment of previous.segments) {
          if (segment.status !== 'done' || !segment.audioPath) continue;
          if (opts.all || opts.only?.includes(segment.id)) continue;
          const reuse = segmentReuseKey(segment);
          if (!reuse) continue;
          const list = pool.get(reuse) ?? [];
          list.push(segment);
          pool.set(reuse, list);
        }
        const kept = new Set<string>();
        const segments: Segment[] = splitScript(settings.text, previous.splitBy).map((part) => {
          const key = `${keyBase}\u0000${part.text}`;
          const reuse = pool.get(reuseKey(voiceKey, settings.language, part.text))?.shift();
          if (reuse) {
            kept.add(reuse.id);
            return {
              ...reuse,
              paragraphEnd: part.paragraphEnd,
              voice: voiceKey,
              lang: settings.language,
            };
          }
          return {
            id: newSegmentId(),
            text: part.text,
            paragraphEnd: part.paragraphEnd,
            status: 'pending',
            key,
            voice: voiceKey,
            lang: settings.language,
            audioPath: null,
            duration: null,
            error: null,
          };
        });
        for (const segment of previous.segments)
          if (segment.audioPath && !kept.has(segment.id)) discarded.push(segment.audioPath);
        setSegmentsState({ segments, currentId: null, finalPath: null, view: 'parts' });

        // 2. Gera, uma a uma, as partes que faltam.
        const total = segments.length;
        const generatedIds: string[] = [];
        let done = segments.filter((segment) => segment.status === 'done').length;
        setProgress(Math.round((done / total) * 100));
        let failures = 0;
        for (const segment of segments) {
          if (segment.status === 'done') continue;
          if (cancelledRef.current) break;
          updateSegment(segment.id, { status: 'generating', error: null });
          setSegmentsState({ currentId: segment.id });
          try {
            const result = await generateClone(
              { ...base, text: segment.text },
              { signal: controller.signal },
            );
            announceResultNotices(result);
            updateSegment(segment.id, {
              status: 'done',
              audioPath: result.audioPath,
              duration: result.durationSeconds,
            });
            generatedIds.push(segment.id);
            done += 1;
            failures = 0;
            setProgress(Math.round((done / total) * 100));
          } catch (err) {
            if (cancelledRef.current) {
              updateSegment(segment.id, { status: 'pending' });
              break;
            }
            failures += 1;
            updateSegment(segment.id, {
              status: 'error',
              error: isModelNotDownloaded(err)
                ? tr('tts_errors.model_not_downloaded')
                : describeError(err),
            });
            if (isModelNotDownloaded(err) || failures >= 3) throw err;
          }
        }
        setSegmentsState({ currentId: null });
        if (cancelledRef.current) return;
        const finished = segmentsStore.state.segments;
        if (finished.some((segment) => segment.status !== 'done' || !segment.audioPath)) {
          setError('Algumas partes falharam. Clique em Sintetizar de novo para refazer só elas.');
          return;
        }

        // 3. Junta tudo num arquivo final.
        setStage('receiving');
        setProgress(null);
        const gaps = segmentsStore.state;
        // Mesmo roteiro (alguma parte reaproveitada): atualiza a mesma tomada final.
        const replaceId = kept.size > 0 ? previous.finalId : null;
        const joined = await apiJson<{
          id: string;
          audio_path: string;
          duration: number;
          offsets?: number[];
          replaced?: boolean;
        }>(
          '/segments/concat',
          {
            method: 'POST',
            signal: controller.signal,
            body: JSON.stringify({
              files: finished.map((segment) => segment.audioPath),
              gaps_ms: finished
                .slice(0, -1)
                .map((segment) =>
                  segment.paragraphEnd ? gaps.paragraphGapMs : gaps.sentenceGapMs,
                ),
              text: settings.text,
              language: settings.language === 'Auto' ? null : settings.language,
              profile_id: settings.selectedProfileId,
              wav_bits: settings.wavBits,
              replace_id: replaceId,
            }),
          },
        );
        const offsets = joined.offsets ?? [];
        segmentsStore.setState((state) => ({
          ...state,
          finalId: joined.id,
          finalPath: joined.audio_path,
          segments: state.segments.map((segment, index) => ({
            ...segment,
            start: offsets[index] ?? null,
          })),
        }));
        // Atualizacao parcial: o player la embaixo ja abre no trecho refeito.
        const focusIndex =
          kept.size > 0 && generatedIds.length
            ? finished.findIndex((segment) => segment.id === generatedIds[0])
            : -1;
        setPendingOutputSeek(
          focusIndex >= 0 && offsets[focusIndex] != null
            ? Math.max(0, offsets[focusIndex] - 0.3)
            : null,
        );
        const audio = await apiFetch('/audio/' + encodeURIComponent(joined.audio_path), {
          signal: controller.signal,
        });
        const blob = await audio.blob();
        setLatestOutput(
          {
            blob,
            id: joined.id,
            audioPath: joined.audio_path,
            durationSeconds: joined.duration,
            genTimeSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
            seed: null,
            routing: null,
            dropped: null,
          },
          settings.text,
        );
        rememberTake(joined.id, settings);
        recordActionBreadcrumb('generate:clone:complete');
        toast.success(
          joined.replaced
            ? generatedIds.length
              ? `${generatedIds.length === 1 ? 'Parte atualizada' : `${generatedIds.length} partes atualizadas`} no mesmo áudio final.`
              : 'Áudio final atualizado.'
            : `Pronto! ${total} partes juntadas num único arquivo.`,
          { position: 'top-right' },
        );
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.history }),
          queryClient.invalidateQueries({ queryKey: ['loaded-models'] }),
          queryClient.invalidateQueries({ queryKey: queryKeys.engines }),
        ]).catch(() => {});
      } catch (err) {
        if (!cancelledRef.current) {
          recordActionBreadcrumb('generate:clone:error');
          setError(
            isAbortError(err)
              ? tr('tts_errors.timeout')
              : isModelNotDownloaded(err)
                ? tr('tts_errors.model_not_downloaded')
                : describeError(err),
          );
        }
      } finally {
        if (discarded.length)
          void apiJson('/segments/delete', {
            method: 'POST',
            body: JSON.stringify({ files: discarded }),
          }).catch(() => {});
        segmentsStore.setState((state) => ({
          ...state,
          currentId: null,
          segments: state.segments.map((segment) =>
            segment.status === 'generating' ? { ...segment, status: 'pending' } : segment,
          ),
        }));
        finishActivity();
        release();
        activeRef.current = false;
        abortRef.current = null;
        reportModeRef.current = null;
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        setIsGenerating(false);
        setProgress(null);
        setModelStage(null);
        setModelProgress(null);
        void queryClient
          .invalidateQueries({
            queryKey: ['sidebar-model-status'],
          })
          .catch(() => {});
      }
    },
    [queryClient, blocker, instructVocabulary, activeTts],
  );

  const cancel = useCallback(() => {
    if (!abortRef.current) return;
    cancelledRef.current = true;
    const reportMode = reportModeRef.current;
    if (reportMode) recordActionBreadcrumb(`generate:${reportMode}:cancel`);
    abortRef.current.abort();
  }, []);

  return {
    generate: () => (segmentsStore.state.enabled ? generateSegments() : generate()),
    generateSegments,
    generateDesign: generate,
    cancel,
    isGenerating,
    elapsedSeconds,
    progress,
    stage,
    modelStage,
    modelProgress,
    error,
    clearError: () => setError(null),
    canGenerate: blocker === null && !isGenerating,
    canGenerateDesign: designBlocker === null && !isGenerating,
    designBlocker,
    designBlockerFor,
    cloneBlocker: blocker,
    instructVocabulary,
  };
}

const GenerationContext = createContext<UseGenerateClone | null>(null);
export function GenerationProvider({ children }: { children: ReactNode }) {
  const value = useGenerateController();
  return createElement(GenerationContext.Provider, { value }, children);
}
export function useGenerateClone(): UseGenerateClone {
  const value = useContext(GenerationContext);
  if (!value) throw new Error('GenerationProvider is required');
  return value;
}
