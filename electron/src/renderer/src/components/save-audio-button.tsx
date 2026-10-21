import { DownloadIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { getBridge } from './bridge';
import { Button } from './ui/button';
import { saveExport } from '@/lib/export-history';

/** WizardStudioVoice: nome padrao dos arquivos salvos (ex.: WizardStudioVoice-2026-10-21_16-10-05). */
export function wizardFileName(extension: string, label?: string): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `WizardStudioVoice-${label ? `${label}-` : ''}${stamp}.${extension}`;
}

export function SaveAudioButton({
  url,
  suggestedName,
  disabled = false,
}: {
  url?: string;
  suggestedName: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const bridge = getBridge();

  const save = async () => {
    if (!url || !bridge) return;
    setSaving(true);
    try {
      const saved = await saveExport(url, suggestedName);
      if (!saved) return;
      if (!saved.canceled && saved.path) {
        const path = saved.path;
        toast.success(t('clone.saved_to', { path }), {
          action: {
            label: t('clone.reveal'),
            onClick: () =>
              void bridge.files.revealPath(path).catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                toast.error(t('clone.download_failed', { message }));
              }),
          },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(t('clone.download_failed', { message }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => void save()}
      disabled={disabled || saving || !url || !bridge}
    >
      <DownloadIcon />
      {t('clone.download')}
    </Button>
  );
}
