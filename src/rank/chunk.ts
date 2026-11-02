export interface Passage {
  /** Heading path above the passage, for example "Install > Docker". Empty when none. */
  section: string;
  text: string;
  wordCount: number;
}

export interface ChunkOptions {
  minWords?: number;
  maxWords?: number;
  /** Passages shorter than this are dropped unless they are the only passage. */
  dropBelowWords?: number;
}

function countWords(text: string): number {
  const m = text.match(/\S+/g);
  return m ? m.length : 0;
}

/** Splits Markdown into blocks: paragraphs, list groups, tables and whole fenced code blocks. */
function splitBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  const flush = () => {
    const block = current.join("\n").trim();
    if (block) blocks.push(block);
    current = [];
  };
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (!inFence) flush();
      current.push(line);
      inFence = !inFence;
      if (!inFence) flush();
      continue;
    }
    if (inFence) {
      current.push(line);
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      flush();
      blocks.push(line.trim());
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return blocks;
}

/** Splits an oversized block on sentence boundaries, falling back to hard word cuts. */
function splitLongBlock(block: string, maxWords: number): string[] {
  const sentences = block.match(/[^.!?\n]+(?:[.!?]+|\n|$)/g) ?? [block];
  const pieces: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence.trim()}` : sentence.trim();
    if (countWords(candidate) > maxWords && current) {
      pieces.push(current);
      current = sentence.trim();
    } else {
      current = candidate;
    }
  }
  if (current) pieces.push(current);

  // A single sentence can still exceed the limit (minified text, long lists).
  return pieces.flatMap((piece) => {
    const w = piece.split(/\s+/);
    if (w.length <= maxWords) return [piece];
    const out: string[] = [];
    for (let i = 0; i < w.length; i += maxWords) out.push(w.slice(i, i + maxWords).join(" "));
    return out;
  });
}

/**
 * Splits Markdown into passages of roughly minWords..maxWords words. Every
 * heading starts a new passage, so short sections become short passages;
 * each passage remembers the heading path it belongs to.
 */
export function chunkMarkdown(
  markdown: string,
  { minWords = 150, maxWords = 300, dropBelowWords = 25 }: ChunkOptions = {},
): Passage[] {
  const passages: Passage[] = [];
  const headings: string[] = [];
  let parts: string[] = [];
  let partWords = 0;
  let section = "";

  const flush = () => {
    if (parts.length === 0) return;
    passages.push({ section, text: parts.join("\n\n"), wordCount: partWords });
    parts = [];
    partWords = 0;
  };

  for (const block of splitBlocks(markdown)) {
    const heading = block.match(/^(#{1,6})\s+(.*?)\s*#*$/);
    if (heading) {
      const level = heading[1].length;
      // Sections never share a passage, so each passage has one accurate heading path.
      flush();
      headings.length = level - 1;
      headings[level - 1] = heading[2];
      if (parts.length === 0) section = headings.filter(Boolean).join(" > ");
      continue;
    }

    for (const piece of countWords(block) > maxWords ? splitLongBlock(block, maxWords) : [block]) {
      const w = countWords(piece);
      if (partWords > 0 && partWords + w > maxWords) flush();
      if (parts.length === 0) section = headings.filter(Boolean).join(" > ");
      parts.push(piece);
      partWords += w;
      if (partWords >= minWords) flush();
    }
  }
  flush();

  // Merge a short trailing passage of the same section into its predecessor when it fits.
  if (passages.length >= 2) {
    const last = passages[passages.length - 1];
    const prev = passages[passages.length - 2];
    if (
      last.section === prev.section &&
      last.wordCount < minWords / 2 &&
      prev.wordCount + last.wordCount <= maxWords * 1.2
    ) {
      prev.text = `${prev.text}\n\n${last.text}`;
      prev.wordCount += last.wordCount;
      passages.pop();
    }
  }

  if (passages.length <= 1) return passages;
  return passages.filter((p) => p.wordCount >= dropBelowWords);
}
