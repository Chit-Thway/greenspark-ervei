/**
 * An AI summary as short paragraphs: the model's own blank-line breaks, or, for an older one-paragraph summary,
 * two sentences at a time.
 */
export function paragraphs(text: string): string[] {
  const parts = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) return parts;
  const sentences = text.trim().match(/[^.!?]+[.!?]+(?:["')\]]+)?(?:\s+|$)|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  if (sentences.length <= 2) return [text.trim()];
  const out: string[] = [];
  for (let i = 0; i < sentences.length; i += 2) out.push(sentences.slice(i, i + 2).join(" "));
  return out;
}
