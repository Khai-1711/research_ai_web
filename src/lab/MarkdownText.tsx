import React from 'react';
import { tokenizeInlineMarkdown } from '../utils/citations.ts';
import { useI18n } from '../utils/i18n.tsx';

interface MarkdownTextProps {
  text: string;
  onCitationClick?: (sourceId: string) => void;
  validSourceIds?: Set<string>;
}

function renderInline(
  line: string,
  t: ReturnType<typeof useI18n>['t'],
  onCitationClick?: (sourceId: string) => void,
  validSourceIds?: Set<string>
): React.ReactNode[] {
  const tokens = tokenizeInlineMarkdown(line);

  return tokens.map((tok, idx) => {
    if (tok.type === 'bold') {
      return (
        <strong key={idx} className="font-semibold text-[var(--ink)]">
          {renderInline(tok.content, t, onCitationClick, validSourceIds)}
        </strong>
      );
    }
    if (tok.type === 'code') {
      return (
        <code
          key={idx}
          className="font-mono-num text-[0.86em] px-1.5 py-0.5 rounded bg-[var(--bg-subtle)] text-[var(--ink)]"
        >
          {tok.content}
        </code>
      );
    }
    if (tok.type === 'link') {
      return (
        <a
          key={idx}
          href={tok.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-[var(--accent)] hover:underline font-medium"
        >
          {tok.label}
        </a>
      );
    }
    if (tok.type === 'inference') {
      return (
        <span key={idx} className="inline-flex flex-wrap items-baseline gap-0.5">
          {tok.sourceIds.map((sid) => {
            const isValid = !validSourceIds || validSourceIds.has(sid);
            return (
              <button
                key={sid}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCitationClick?.(sid);
                }}
                title={t('inferredTooltip', { id: sid })}
                className={`inline-flex items-center font-mono-num text-[11px] font-medium mx-0.5 px-1.5 py-0.2 rounded border transition-colors cursor-pointer align-baseline ${
                  isValid
                    ? 'bg-[var(--bg-subtle)] border-[var(--border-strong)] text-[var(--ink-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
                    : 'bg-[var(--warn-soft)] border-[var(--warn)]/40 text-[var(--warn)]'
                }`}
              >
                {t('inferredBadge', { id: sid })}
              </button>
            );
          })}
        </span>
      );
    }
    if (tok.type === 'citation') {
      return (
        <span key={idx} className="inline-flex flex-wrap items-baseline gap-0.5">
          {tok.sourceIds.map((sid) => {
            const isValid = !validSourceIds || validSourceIds.has(sid);
            return (
              <button
                key={sid}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCitationClick?.(sid);
                }}
                title={
                  isValid ? t('directCitTooltip', { id: sid }) : t('invalidCitTooltip', { id: sid })
                }
                className={`inline-flex items-center font-mono-num text-[11px] font-medium mx-0.5 px-1.5 py-0.2 rounded transition-colors cursor-pointer align-baseline ${
                  isValid
                    ? 'bg-[var(--accent-soft)] text-[var(--accent)] hover:underline'
                    : 'bg-[var(--warn-soft)] text-[var(--warn)]'
                }`}
              >
                [{sid}]
              </button>
            );
          })}
        </span>
      );
    }
    return <React.Fragment key={idx}>{tok.raw}</React.Fragment>;
  });
}

function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|') || !trimmed.includes('-')) return false;
  return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(trimmed);
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

type ParsedBlock =
  | { kind: 'code'; lang: string; content: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'hr' }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'p'; lines: string[] };

function parseMarkdownBlocks(text: string): ParsedBlock[] {
  const lines = (text || '').replace(/\r\n/g, '\n').split('\n');
  const blocks: ParsedBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      blocks.push({ kind: 'code', lang, content: codeLines.join('\n') });
      continue;
    }

    if (/^[-*_]{3,}$/.test(trimmed)) {
      blocks.push({ kind: 'hr' });
      i++;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({ kind: 'heading', level: headingMatch[1].length, text: headingMatch[2] });
      i++;
      continue;
    }

    if (
      i + 1 < lines.length &&
      trimmed.includes('|') &&
      isTableSeparatorLine(lines[i + 1])
    ) {
      const headers = splitTableRow(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().includes('|')) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push({ kind: 'table', headers, rows });
      continue;
    }

    if (trimmed.startsWith('>')) {
      const qLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        qLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ kind: 'quote', lines: qLines });
      continue;
    }

    if (/^[•\-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[•\-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[•\-*]\s+/, ''));
        i++;
      }
      blocks.push({ kind: 'ul', items });
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ kind: 'ol', items });
      continue;
    }

    const pLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trim().startsWith('```') &&
      !/^(#{1,4})\s+/.test(lines[i].trim()) &&
      !/^[-*_]{3,}$/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith('>') &&
      !/^[•\-*]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim()) &&
      !(i + 1 < lines.length && lines[i].trim().includes('|') && isTableSeparatorLine(lines[i + 1]))
    ) {
      pLines.push(lines[i]);
      i++;
    }
    if (pLines.length > 0) {
      blocks.push({ kind: 'p', lines: pLines });
    }
  }

  return blocks;
}

export function MarkdownText({ text, onCitationClick, validSourceIds }: MarkdownTextProps) {
  const { t } = useI18n();
  const blocks = parseMarkdownBlocks(text);

  return (
    <div className="space-y-2.5 text-[15px] leading-[1.68] text-[var(--ink)]">
      {blocks.map((block, bIdx) => {
        if (block.kind === 'hr') {
          return <hr key={bIdx} className="border-t border-[var(--border)] my-3" />;
        }

        if (block.kind === 'code') {
          return (
            <pre
              key={bIdx}
              className="p-3.5 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border)] font-mono-num text-[12.5px] leading-relaxed overflow-x-auto text-[var(--ink)]"
            >
              <code>{block.content}</code>
            </pre>
          );
        }

        if (block.kind === 'heading') {
          const sizeClass =
            block.level <= 2
              ? 'font-display text-[17px] font-semibold text-[var(--ink)] pt-1.5'
              : 'text-[15px] font-semibold text-[var(--ink)] pt-1';
          return (
            <div key={bIdx} className={sizeClass}>
              {renderInline(block.text, t, onCitationClick, validSourceIds)}
            </div>
          );
        }

        if (block.kind === 'quote') {
          return (
            <blockquote
              key={bIdx}
              className="pl-3.5 py-1 border-l-2 border-[var(--accent)]/60 text-[14px] text-[var(--ink-secondary)] italic space-y-1"
            >
              {block.lines.map((l, lIdx) => (
                <div key={lIdx}>{renderInline(l, t, onCitationClick, validSourceIds)}</div>
              ))}
            </blockquote>
          );
        }

        if (block.kind === 'table') {
          return (
            <div
              key={bIdx}
              className="overflow-x-auto rounded-xl border border-[var(--border)] my-2"
            >
              <table className="w-full text-left text-[13px] border-collapse">
                <thead className="bg-[var(--bg-subtle)] text-[var(--ink-secondary)]">
                  <tr>
                    {block.headers.map((h, hIdx) => (
                      <th
                        key={hIdx}
                        className="py-2 px-3 font-semibold border-b border-[var(--border)] whitespace-nowrap"
                      >
                        {renderInline(h, t, onCitationClick, validSourceIds)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {block.rows.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-[var(--surface-hover)]">
                      {block.headers.map((_, cIdx) => (
                        <td key={cIdx} className="py-2 px-3 align-top text-[var(--ink)]">
                          {renderInline(row[cIdx] ?? '', t, onCitationClick, validSourceIds)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (block.kind === 'ul') {
          return (
            <ul key={bIdx} className="space-y-1.5 pl-4 list-disc marker:text-[var(--ink-muted)]">
              {block.items.map((item, lIdx) => (
                <li key={lIdx} className="pl-1">
                  {renderInline(item, t, onCitationClick, validSourceIds)}
                </li>
              ))}
            </ul>
          );
        }

        if (block.kind === 'ol') {
          return (
            <ol key={bIdx} className="space-y-1.5 pl-5 list-decimal marker:text-[var(--ink-muted)]">
              {block.items.map((item, lIdx) => (
                <li key={lIdx} className="pl-1">
                  {renderInline(item, t, onCitationClick, validSourceIds)}
                </li>
              ))}
            </ol>
          );
        }

        return (
          <p key={bIdx} className="whitespace-pre-line">
            {block.lines.map((line, lIdx) => (
              <React.Fragment key={lIdx}>
                {lIdx > 0 && <br />}
                {renderInline(line, t, onCitationClick, validSourceIds)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
