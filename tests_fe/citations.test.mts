import assert from 'node:assert/strict';
import test from 'node:test';
import { expandCitationGroup, tokenizeInlineMarkdown } from '../src/utils/citations.ts';

test('expandCitationGroup handles commas, semicolons, CJK fullwidth, ranges, and cap', () => {
  assert.deepEqual(expandCitationGroup('S1'), ['S1']);
  assert.deepEqual(expandCitationGroup('S1, S2'), ['S1', 'S2']);
  assert.deepEqual(expandCitationGroup('S1; S2'), ['S1', 'S2']);
  assert.deepEqual(expandCitationGroup('S1 và S2'), ['S1', 'S2']);
  assert.deepEqual(expandCitationGroup('S1-S3'), ['S1', 'S2', 'S3']);
  assert.deepEqual(expandCitationGroup('S1、S2'), ['S1', 'S2']);
  assert.deepEqual(expandCitationGroup('S1，S2'), ['S1', 'S2']);
  assert.deepEqual(expandCitationGroup('S1とS2'), ['S1', 'S2']);
  assert.deepEqual(expandCitationGroup('S2,4'), ['S2', 'S4']);
  // Vượt ngưỡng MAX_CITATION_RANGE = 20 không bung dải khổng lồ
  assert.deepEqual(expandCitationGroup('S1-S99'), ['S1', 'S99']);
});

test('tokenizeInlineMarkdown splits group citations and multi-id inferences without breaking links, bold, or code', () => {
  const sample =
    'Theo [S1, S2] và [S1-S3] [S1，S2] [S1とS2]; [Inferred from S1, S2] và [Suy luận từ S2, S3]. ' +
    'Xem [tài liệu](https://example.com) với **đậm [S1, S2]** và `[S1, S2]`.';
  const tokens = tokenizeInlineMarkdown(sample);

  const citationTokens = tokens.filter((t) => t.type === 'citation');
  assert.deepEqual(
    citationTokens.map((t) => t.sourceIds),
    [['S1', 'S2'], ['S1', 'S2', 'S3'], ['S1', 'S2'], ['S1', 'S2']]
  );

  const infTokens = tokens.filter((t) => t.type === 'inference');
  assert.deepEqual(
    infTokens.map((t) => t.sourceIds),
    [['S1', 'S2'], ['S2', 'S3']]
  );

  const linkTokens = tokens.filter((t) => t.type === 'link');
  assert.equal(linkTokens.length, 1);
  assert.equal(linkTokens[0].url, 'https://example.com');

  const boldTokens = tokens.filter((t) => t.type === 'bold');
  assert.equal(boldTokens.length, 1);
  assert.equal(boldTokens[0].content, 'đậm [S1, S2]');

  const codeTokens = tokens.filter((t) => t.type === 'code');
  assert.equal(codeTokens.length, 1);
  assert.equal(codeTokens[0].content, '[S1, S2]');
});
