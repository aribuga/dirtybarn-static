import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSafeMarkdown } from '../src/lib/markdown-render.mjs';

test('safe Markdown rendering preserves content structure and removes active HTML', async () => {
  const html = await renderSafeMarkdown(`
## Heading

First paragraph.

- **Bold item**
- [Safe link](https://example.com)

<script>alert(1)</script>
<iframe src="https://example.com/embed"></iframe>
<img src="javascript:alert(2)" onerror="alert(3)" style="display:none">
  `);
  assert.match(html, /<h2[^>]*>Heading<\/h2>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<strong>Bold item<\/strong>/);
  assert.doesNotMatch(html, /<script|<iframe|onerror|style=|javascript:/i);
  assert.match(html, /rel="noopener noreferrer"/);
});
