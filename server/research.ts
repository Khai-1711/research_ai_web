import type { SourceItem } from '../src/types.ts';

function cleanText(text: string, maxLen = 280): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) return normalized;
  return normalized.slice(0, maxLen - 1).trimEnd() + '…';
}

function isSafePublicUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('169.254.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'ResearchLab/2.0 (Academic Open Search)',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function searchArxiv(query: string): Promise<Omit<SourceItem, 'id'>[]> {
  try {
    const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=2`;
    const res = await fetchWithTimeout(url, 7000);
    if (!res.ok) return [];
    const xml = await res.text();
    const entries = xml.split('<entry>').slice(1);
    const results: Omit<SourceItem, 'id'>[] = [];
    for (const entry of entries) {
      const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);
      const summaryMatch = entry.match(/<summary>([\s\S]*?)<\/summary>/);
      const idMatch = entry.match(/<id>([\s\S]*?)<\/id>/);
      const pubMatch = entry.match(/<published>(\d{4})/);
      if (titleMatch && idMatch) {
        results.push({
          origin: `arXiv · ${pubMatch?.[1] ?? 'Recent'}`,
          title: cleanText(titleMatch[1], 140),
          excerpt: cleanText(summaryMatch?.[1] ?? 'Tài liệu nghiên cứu trên arXiv.', 260),
          url: idMatch[1].trim(),
          verified: true,
          addedAt: new Date().toISOString(),
        });
      }
    }
    return results;
  } catch {
    return [];
  }
}

async function searchOpenAlex(query: string): Promise<Omit<SourceItem, 'id'>[]> {
  try {
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=2`;
    const res = await fetchWithTimeout(url, 7000);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      results?: Array<{
        title?: string;
        publication_year?: number;
        id?: string;
        doi?: string;
        abstract_inverted_index?: Record<string, number[]>;
      }>;
    };
    const results: Omit<SourceItem, 'id'>[] = [];
    for (const item of data.results ?? []) {
      if (!item.title) continue;
      let excerpt = 'Công trình học thuật lập chỉ mục trên OpenAlex.';
      if (item.abstract_inverted_index) {
        const words: string[] = [];
        for (const [word, positions] of Object.entries(item.abstract_inverted_index)) {
          for (const pos of positions) {
            words[pos] = word;
          }
        }
        const reconstructed = words.filter(Boolean).join(' ');
        if (reconstructed) excerpt = cleanText(reconstructed, 260);
      }
      results.push({
        origin: `OpenAlex · ${item.publication_year ?? '2025'}`,
        title: cleanText(item.title, 140),
        excerpt,
        url: item.doi || item.id || 'https://openalex.org',
        verified: true,
        addedAt: new Date().toISOString(),
      });
    }
    return results;
  } catch {
    return [];
  }
}

async function searchWikipedia(query: string): Promise<Omit<SourceItem, 'id'>[]> {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json&srlimit=2`;
    const res = await fetchWithTimeout(url, 6000);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      query?: { search?: Array<{ title: string; snippet: string; pageid: number }> };
    };
    return (data.query?.search ?? []).map((item) => ({
      origin: 'Wikipedia',
      title: cleanText(item.title, 120),
      excerpt: cleanText(item.snippet.replace(/<[^>]+>/g, ''), 240),
      url: `https://en.wikipedia.org/?curid=${item.pageid}`,
      verified: true,
      addedAt: new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

export async function searchOpenAcademicSources(query: string): Promise<Omit<SourceItem, 'id'>[]> {
  const [arxiv, openAlex, wiki] = await Promise.all([
    searchArxiv(query),
    searchOpenAlex(query),
    searchWikipedia(query),
  ]);
  return [...arxiv, ...openAlex, ...wiki].slice(0, 5);
}

export async function fetchUrlAsSource(rawUrl: string): Promise<Omit<SourceItem, 'id'>> {
  if (!isSafePublicUrl(rawUrl)) {
    throw new Error('URL không hợp lệ hoặc thuộc địa chỉ mạng nội bộ bị chặn.');
  }
  const res = await fetchWithTimeout(rawUrl, 8000);
  if (!res.ok) {
    throw new Error(`Không tải được URL (HTTP ${res.status}).`);
  }
  const html = await res.text();
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const hostname = new URL(rawUrl).hostname.replace(/^www\./, '');
  return {
    origin: `URL · ${hostname}`,
    title: cleanText(titleMatch?.[1] || rawUrl, 130),
    excerpt: cleanText(stripped || 'Đã đính kèm nội dung trang web vào kho nguồn.', 320),
    url: rawUrl,
    verified: true,
    addedAt: new Date().toISOString(),
  };
}
