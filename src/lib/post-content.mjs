import * as cheerio from 'cheerio';

function headingSlug(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';
}

export function enhancePostContent(html) {
  const $ = cheerio.load(String(html || ''), null, false);
  const usedIds = new Set();
  const toc = [];

  $('h2, h3').each((_, element) => {
    const node = $(element);
    const text = node.text().replace(/\s+/g, ' ').trim();
    if (!text) return;
    const existing = String(node.attr('id') || '').trim();
    const base = existing || headingSlug(text);
    let id = base;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    node.attr('id', id);
    toc.push({ id, text, level: element.tagName === 'h3' ? 3 : 2 });
  });

  $('p').first().addClass('article-lede');

  return { html: $.html(), toc };
}
