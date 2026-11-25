import type { ClaimSupportCounts, SourceItem, SourceType } from '../types.ts';
import { getLocaleForLanguage, translate, type UiLanguage } from './i18n.tsx';

/** Nguồn có sức nặng bằng chứng thấp hơn bài đã xuất bản: hiển thị màu cảnh báo. */
export function isWeakEvidenceSource(type?: SourceType): boolean {
  return type === 'preprint' || type === 'encyclopedia' || type === 'web';
}

const SOURCE_TYPE_KEYS: Record<
  SourceType,
  | 'srcTypePreprint'
  | 'srcTypePublished'
  | 'srcTypeOtherScholarly'
  | 'srcTypeEncyclopedia'
  | 'srcTypeWeb'
  | 'srcTypeWebPdf'
  | 'srcTypeUserUpload'
  | 'srcTypeUserExcerpt'
> = {
  preprint: 'srcTypePreprint',
  published_venue: 'srcTypePublished',
  other_scholarly: 'srcTypeOtherScholarly',
  encyclopedia: 'srcTypeEncyclopedia',
  web: 'srcTypeWeb',
  web_pdf: 'srcTypeWebPdf',
  user_upload: 'srcTypeUserUpload',
  user_excerpt: 'srcTypeUserExcerpt',
};

export function sourceTypeLabel(
  source: Pick<SourceItem, 'sourceType' | 'venue'>,
  lang: UiLanguage = 'vi'
): string {
  if (!source.sourceType) return translate(lang, 'srcTypeUnclassified');
  const key = SOURCE_TYPE_KEYS[source.sourceType];
  const base = key ? translate(lang, key) : source.sourceType;
  return source.sourceType === 'published_venue' && source.venue ? `${base}: ${source.venue}` : base;
}

export function describeRetrieval(
  source: Pick<SourceItem, 'retrieval'>,
  lang: UiLanguage = 'vi'
): string {
  const r = source.retrieval;
  if (!r) return '';
  const when = r.retrievedAt ? new Date(r.retrievedAt).toLocaleString(getLocaleForLanguage(lang)) : '';
  if (r.query) {
    return translate(lang, 'retQuery', {
      provider: r.provider,
      query: r.query,
      rank: r.rank ?? '?',
      when,
    });
  }
  if (r.finalUrl) return translate(lang, 'retUrl', { when });
  if (r.filename) return translate(lang, 'retUpload', { filename: r.filename, when });
  return `${r.provider} · ${when}`;
}

export function formatClaimCounts(c?: ClaimSupportCounts, lang: UiLanguage = 'vi'): string {
  if (!c || c.checked === 0) return translate(lang, 'claimUnchecked');
  return translate(lang, 'claimSummary', {
    supported: c.supported,
    checked: c.checked,
    partial: c.partial,
    unsupported: c.unsupported,
    unclear: c.unclear,
  });
}
