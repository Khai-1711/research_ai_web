/**
 * Bộ tách và mở rộng trích dẫn [S#] dùng chung cho MarkdownText và thống kê Báo cáo.
 * Giữ đồng bộ logic với `expand_citation_group` trong `app/verifier.py`.
 */

export const MAX_CITATION_RANGE = 20;

const CITATION_TOKEN_RE = /S?(\d+)|([-–—])/gi;

const INFERENCE_PREFIX_RE =
  /^\[\s*(?:Suy\s+luận\s+từ|Inferred\s+from|Inference\s+from|推论自|推論[:：]?|추론[:：]?)\s*([\s\S]*?)\]$/i;

const DIRECT_GROUP_INNER_RE =
  /^\[\s*(S\d+(?:\s*(?:,|;|，|；|&|、|và|and|和|と|및|[-–—])\s*S?\d+)*)\s*\]$/i;

export const INLINE_MARKDOWN_TOKEN_RE =
  /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\)|\[\s*(?:Suy\s+luận\s+từ|Inferred\s+from|Inference\s+from|推论自|推論[:：]?|추론[:：]?)\s*[^\]]*?S\d+[^\]]*\]|\[\s*S\d+(?:\s*(?:,|;|，|；|&|、|và|and|和|と|및|[-–—])\s*S?\d+)*\s*\])/gi;

/** Mở rộng chuỗi nhóm mã nguồn: 'S1, S3' -> ['S1','S3']; 'S1-S3' -> ['S1','S2','S3']; 'S2,4' -> ['S2','S4']. */
export function expandCitationGroup(group: string): string[] {
  const numbers: number[] = [];
  let prev: number | null = null;
  let pendingRange = false;

  CITATION_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CITATION_TOKEN_RE.exec(group || '')) !== null) {
    if (match[2]) {
      pendingRange = prev !== null;
      continue;
    }
    const n = Number.parseInt(match[1], 10);
    if (pendingRange && prev !== null && prev < n && n <= prev + MAX_CITATION_RANGE) {
      for (let k = prev + 1; k <= n; k++) {
        numbers.push(k);
      }
    } else {
      numbers.push(n);
    }
    prev = n;
    pendingRange = false;
  }

  return Array.from(new Set(numbers)).map((n) => `S${n}`);
}

export function extractInferenceCitationIds(inner: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\bS(\d+)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner || '')) !== null) {
    const sid = `S${m[1]}`;
    if (!seen.has(sid)) {
      seen.add(sid);
      out.push(sid);
    }
  }
  return out;
}

export type InlineToken =
  | { type: 'text'; raw: string }
  | { type: 'bold'; raw: string; content: string }
  | { type: 'code'; raw: string; content: string }
  | { type: 'link'; raw: string; label: string; url: string }
  | { type: 'inference'; raw: string; sourceIds: string[] }
  | { type: 'citation'; raw: string; sourceIds: string[] };

export function tokenizeInlineMarkdown(line: string): InlineToken[] {
  const parts = (line || '').split(INLINE_MARKDOWN_TOKEN_RE);
  const tokens: InlineToken[] = [];

  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      tokens.push({ type: 'bold', raw: part, content: part.slice(2, -2) });
      continue;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      tokens.push({ type: 'code', raw: part, content: part.slice(1, -1) });
      continue;
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
    if (linkMatch) {
      tokens.push({ type: 'link', raw: part, label: linkMatch[1], url: linkMatch[2] });
      continue;
    }
    const infMatch = part.match(INFERENCE_PREFIX_RE);
    if (infMatch) {
      const ids = extractInferenceCitationIds(infMatch[1]);
      if (ids.length > 0) {
        tokens.push({ type: 'inference', raw: part, sourceIds: ids });
        continue;
      }
    }
    const citMatch = part.match(DIRECT_GROUP_INNER_RE);
    if (citMatch) {
      const ids = expandCitationGroup(citMatch[1]);
      if (ids.length > 0) {
        tokens.push({ type: 'citation', raw: part, sourceIds: ids });
        continue;
      }
    }
    tokens.push({ type: 'text', raw: part });
  }
  return tokens;
}

export function countInlineCitations(
  text: string,
  validSourceIds?: Set<string>
): { totalFound: number; validCount: number; inferredCount: number } {
  let totalFound = 0;
  let validCount = 0;
  let inferredCount = 0;

  for (const tok of tokenizeInlineMarkdown(text)) {
    if (tok.type === 'bold') {
      const sub = countInlineCitations(tok.content, validSourceIds);
      totalFound += sub.totalFound;
      validCount += sub.validCount;
      inferredCount += sub.inferredCount;
    } else if (tok.type === 'citation') {
      for (const sid of tok.sourceIds) {
        totalFound++;
        if (!validSourceIds || validSourceIds.has(sid)) validCount++;
      }
    } else if (tok.type === 'inference') {
      inferredCount += tok.sourceIds.length;
    }
  }
  return { totalFound, validCount, inferredCount };
}
