import React from 'react';

interface MarkdownTextProps {
  text: string;
  onCitationClick?: (sourceId: string) => void;
  validSourceIds?: Set<string>;
}

function renderInline(
  line: string,
  onCitationClick?: (sourceId: string) => void,
  validSourceIds?: Set<string>
): React.ReactNode[] {
  const tokenRegex = /(\*\*[^*]+\*\*|`[^`]+`|\[S\d+\])/g;
  const parts = line.split(tokenRegex);

  return parts.map((part, idx) => {
    if (!part) return null;
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={idx} className="font-semibold text-[var(--ink)]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={idx}
          className="font-mono-num text-[0.86em] px-1.5 py-0.5 rounded bg-[var(--bg-subtle)] text-[var(--ink)]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    const citMatch = part.match(/^\[(S\d+)\]$/);
    if (citMatch) {
      const sid = citMatch[1];
      const isValid = !validSourceIds || validSourceIds.has(sid);
      return (
        <button
          key={idx}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCitationClick?.(sid);
          }}
          title={`Xem nguồn trích dẫn ${sid}`}
          className={`inline-flex items-center font-mono-num text-[11px] font-medium mx-0.5 px-1.5 py-0.2 rounded transition-colors cursor-pointer align-baseline ${
            isValid
              ? 'bg-[var(--accent-soft)] text-[var(--accent)] hover:underline'
              : 'bg-[var(--warn-soft)] text-[var(--warn)]'
          }`}
        >
          [{sid}]
        </button>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export function MarkdownText({ text, onCitationClick, validSourceIds }: MarkdownTextProps) {
  const blocks = text.split(/\n\n+/);

  return (
    <div className="space-y-2.5 text-[15px] leading-[1.68] text-[var(--ink)]">
      {blocks.map((block, bIdx) => {
        const lines = block.split('\n').filter((l) => l.trim().length > 0);
        const isBulletList = lines.length > 0 && lines.every((l) => /^[•\-*]\s+/.test(l.trim()));
        const isOrderedList = lines.length > 0 && lines.every((l) => /^\d+\.\s+/.test(l.trim()));

        if (isBulletList) {
          return (
            <ul key={bIdx} className="space-y-1.5 pl-4 list-disc marker:text-[var(--ink-muted)]">
              {lines.map((line, lIdx) => (
                <li key={lIdx} className="pl-1">
                  {renderInline(line.trim().replace(/^[•\-*]\s+/, ''), onCitationClick, validSourceIds)}
                </li>
              ))}
            </ul>
          );
        }

        if (isOrderedList) {
          return (
            <ol key={bIdx} className="space-y-1.5 pl-5 list-decimal marker:text-[var(--ink-muted)]">
              {lines.map((line, lIdx) => (
                <li key={lIdx} className="pl-1">
                  {renderInline(line.trim().replace(/^\d+\.\s+/, ''), onCitationClick, validSourceIds)}
                </li>
              ))}
            </ol>
          );
        }

        return (
          <p key={bIdx} className="whitespace-pre-line">
            {lines.map((line, lIdx) => (
              <React.Fragment key={lIdx}>
                {lIdx > 0 && <br />}
                {renderInline(line, onCitationClick, validSourceIds)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
