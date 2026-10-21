// WizardStudioVoice: divide o roteiro em partes para a geracao por partes.

export type SplitMode = 'paragraph' | 'sentence';

export interface ScriptPart {
  text: string;
  /** true quando esta parte fecha um paragrafo (pausa maior depois dela). */
  paragraphEnd: boolean;
}

/** Paragrafos maiores que isso sao quebrados em grupos de frases. */
export const MAX_PART_CHARS = 450;

// Abreviacoes que terminam em ponto mas nao terminam a frase.
const ABBREVIATIONS = new Set([
  'sr', 'sra', 'srta', 'dr', 'dra', 'prof', 'profa', 'sto', 'sta', 'av', 'etc', 'vs',
  'pag', 'pág', 'nº', 'no', 'eng', 'exmo', 'exma', 'ltda', 'cia', 'mr', 'mrs', 'ms', 'st', 'jr',
]);

/** Fim de frase: pontuacao (+ aspas/parenteses de fechamento) seguida de espaco. */
const BOUNDARY_RE = /[.!?…]+["'”’»)\]]*\s+/gu;

export function splitSentences(paragraph: string): string[] {
  const out: string[] = [];
  let start = 0;
  BOUNDARY_RE.lastIndex = 0;
  for (let match = BOUNDARY_RE.exec(paragraph); match; match = BOUNDARY_RE.exec(paragraph)) {
    const end = match.index + match[0].length;
    const next = paragraph[end] ?? '';
    const lastWord = (paragraph.slice(start, match.index).match(/([\p{L}º]+)$/u)?.[1] ?? '')
      .toLowerCase();
    const isAbbreviation = match[0].trim() === '.' && ABBREVIATIONS.has(lastWord);
    // Proxima palavra em minuscula: nao e fim de frase ("disse!" e saiu).
    if (isAbbreviation || /[a-zà-ÿ]/u.test(next)) continue;
    const sentence = paragraph.slice(start, end).trim();
    if (sentence) out.push(sentence);
    start = end;
  }
  const rest = paragraph.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

function groupSentences(sentences: string[], max: number): string[] {
  const groups: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && current.length + 1 + sentence.length > max) {
      groups.push(current);
      current = sentence;
    } else current = current ? `${current} ${sentence}` : sentence;
  }
  if (current) groups.push(current);
  return groups;
}

export function splitScript(text: string, mode: SplitMode): ScriptPart[] {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const parts: ScriptPart[] = [];
  for (const paragraph of paragraphs) {
    const pieces =
      mode === 'sentence'
        ? splitSentences(paragraph)
        : paragraph.length > MAX_PART_CHARS
          ? groupSentences(splitSentences(paragraph), MAX_PART_CHARS)
          : [paragraph];
    pieces.forEach((piece, index) =>
      parts.push({ text: piece, paragraphEnd: index === pieces.length - 1 }),
    );
  }
  return parts;
}
