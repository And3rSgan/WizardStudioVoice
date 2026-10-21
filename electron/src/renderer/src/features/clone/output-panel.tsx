import { AudioLinesIcon, XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { SaveAudioButton, wizardFileName } from '@/components/save-audio-button';
import { useState } from 'react';
import { WaveformPlayer } from '@/components/waveform-player';
import { audioUrl } from '@/lib/api/client';
import { clearLatestOutput, takePendingOutputSeek, useLatestOutput } from '@/lib/store/output';
import { requestPlaybackSeek } from '@/lib/audio/playback-clock';
import { activePlaybackSource, stopActivePlayback } from '@/lib/audio/playback';
import { formatSeconds } from './format';
import { AudioQuality } from './audio-quality';
import { AudioFileDetails } from './audio-file-details';
import { SectionLabel } from './section-label';

const SAVE_FORMAT_KEY = 'wizardstudiovoice.saveFormat';

export function OutputPanel() {
  const { t } = useTranslation();
  const { result, objectUrl, text } = useLatestOutput();
  const [format, setFormat] = useState<'wav' | 'mp3'>(() => {
    try {
      return localStorage.getItem(SAVE_FORMAT_KEY) === 'mp3' ? 'mp3' : 'wav';
    } catch {
      return 'wav';
    }
  });
  if (!result || !objectUrl) return null;

  const chooseFormat = (value: 'wav' | 'mp3') => {
    setFormat(value);
    try {
      localStorage.setItem(SAVE_FORMAT_KEY, value);
    } catch {
      /* so nesta sessao */
    }
  };
  const playbackUrl = result.audioPath ? audioUrl(result.audioPath) : objectUrl;

  return (
    <section
      aria-label={t('clone.output_title')}
      className="w-full shrink-0 border-t border-border/60 bg-muted/15 px-6 py-3"
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <SectionLabel>
            <AudioLinesIcon aria-hidden="true" />
            {t('clone.output_title')}
          </SectionLabel>
          <div className="flex items-center gap-1">
            <div
              role="group"
              aria-label="Formato ao salvar"
              className="flex overflow-hidden rounded-md border border-border/60 text-xs"
            >
              {(['wav', 'mp3'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={format === value}
                  title={value === 'wav' ? 'WAV: qualidade máxima' : 'MP3: arquivo bem menor'}
                  onClick={() => chooseFormat(value)}
                  className={
                    format === value
                      ? 'bg-primary/20 px-2 py-1 font-medium text-foreground'
                      : 'px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground'
                  }
                >
                  {value.toUpperCase()}
                </button>
              ))}
            </div>
            <SaveAudioButton
              url={result.audioPath ? audioUrl(result.audioPath) : undefined}
              suggestedName={wizardFileName(format)}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('common.close')}
              title={t('common.close')}
              onClick={() => {
                if (activePlaybackSource() === 'output') stopActivePlayback();
                clearLatestOutput();
              }}
            >
              <XIcon />
            </Button>
          </div>
        </div>
        {result && objectUrl ? (
          <>
            {/* Chaves distintas: com a mesma chave do AudioQuality, o React nao
                removia o player antigo e as barras se acumulavam. */}
            <WaveformPlayer
              key={`player:${objectUrl}`}
              src={playbackUrl}
              source="output"
              height={36}
              onCanPlay={() => {
                const seconds = takePendingOutputSeek();
                if (seconds != null) requestPlaybackSeek('output', seconds);
              }}
            />
            <AudioFileDetails blob={result.blob} />
            {result.audioPath && <AudioQuality key={`quality:${objectUrl}`} audioPath={result.audioPath} />}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p
                className="line-clamp-2 min-w-40 flex-1 text-sm text-muted-foreground"
                title={text}
              >
                {text}
              </p>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {t('clone.output_meta', {
                  duration: formatSeconds(result.durationSeconds),
                  gen: formatSeconds(result.genTimeSeconds),
                })}
              </span>
            </div>
          </>
        ) : (
          <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed text-[length:var(--text-label)] text-muted-foreground">
            {t('clone.output_empty')}
          </div>
        )}
      </div>
    </section>
  );
}
