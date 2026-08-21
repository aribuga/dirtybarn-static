import * as cheerio from 'cheerio';
import sanitizeHtml from 'sanitize-html';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const SHORTCODE_PATTERN = /\[(?!\/)([A-Za-z][\w-]*)(?:\s[^\]\r\n]*)?\]/g;

function shortcodeToken(index) {
  return `CODEXWORDPRESSSHORTCODENOTE${index}END`;
}

function chooseLargestImageSource(element) {
  const src = element.attribs?.src?.trim() || '';
  const candidates = (element.attribs?.srcset || '')
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/))
    .map(([url, descriptor]) => {
      const width = descriptor?.endsWith('w') ? Number.parseInt(descriptor, 10) : 0;
      const density = descriptor?.endsWith('x') ? Number.parseFloat(descriptor) * 10_000 : 0;
      return { url, score: Number.isFinite(width + density) ? width + density : 0 };
    })
    .filter(({ url }) => /^https?:\/\//i.test(url));
  candidates.push({ url: src, score: 1 });
  candidates.sort((left, right) => right.score - left.score);
  return candidates.find(({ url }) => /^https?:\/\//i.test(url))?.url || src;
}

export function extractContentImages(html) {
  const $ = cheerio.load(String(html ?? ''), null, false);
  const seen = new Set();
  const images = [];
  $('img').each((_, element) => {
    const url = chooseLargestImageSource(element);
    if (!url || seen.has(url)) return;
    seen.add(url);
    images.push({ url, alt: $(element).attr('alt') || '' });
  });
  return images;
}

function removeTrackingAndUnsafeMarkup($) {
  $('script, style, noscript, template').remove();
  $('*').each((_, element) => {
    const node = $(element);
    for (const attribute of Object.keys(element.attribs || {})) {
      if (/^on/i.test(attribute) || ['style', 'class', 'id'].includes(attribute.toLowerCase())) {
        node.removeAttr(attribute);
      }
    }
  });
  $('img').each((_, element) => {
    const node = $(element);
    const width = Number.parseFloat(node.attr('width'));
    const height = Number.parseFloat(node.attr('height'));
    const source = `${node.attr('src') || ''} ${node.attr('alt') || ''}`.toLowerCase();
    if (
      (Number.isFinite(width) && width <= 1 && Number.isFinite(height) && height <= 1) ||
      /\b(pixel|tracking|analytics|beacon)\b/.test(source)
    ) {
      node.remove();
    }
  });
  $('span').each((_, element) => {
    const node = $(element);
    if (node.text().trim() || node.children().length) node.replaceWith(node.contents());
    else node.remove();
  });
  $('div, p').each((_, element) => {
    const node = $(element);
    if (!node.text().trim() && node.find('img, video, audio, iframe, hr').length === 0) node.remove();
  });
}

function sanitizedHtml(html) {
  return sanitizeHtml(html, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      'img',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'table',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'th',
      'td',
    ],
    allowedAttributes: {
      a: ['href', 'title'],
      img: ['src', 'alt', 'title'],
      th: ['colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
      code: ['class'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
  });
}

export function htmlToPlainText(html) {
  const $ = cheerio.load(String(html ?? ''), null, false);
  $('script, style, noscript, template, img, svg, iframe').remove();
  const text = $.root().text();
  return text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

export function htmlToMarkdown(html, imageReplacements = new Map()) {
  let tokenIndex = 0;
  const shortcodes = [];
  const tokenized = String(html ?? '').replace(SHORTCODE_PATTERN, (original, name) => {
    const token = shortcodeToken(tokenIndex);
    shortcodes.push({ name, original, token });
    tokenIndex += 1;
    return token;
  });

  const $ = cheerio.load(tokenized, null, false);
  removeTrackingAndUnsafeMarkup($);
  $('img').each((_, element) => {
    const node = $(element);
    const selectedSource = chooseLargestImageSource(element);
    const localSource = imageReplacements.get(selectedSource) || imageReplacements.get(node.attr('src'));
    if (localSource) node.attr('src', localSource);
    else if (selectedSource) node.attr('src', selectedSource);
    node.removeAttr('srcset');
    node.removeAttr('sizes');
  });

  const clean = sanitizedHtml($.html());
  const turndown = new TurndownService({
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
    headingStyle: 'atx',
  });
  turndown.use(gfm);
  let markdown = turndown.turndown(clean);
  for (const shortcode of shortcodes) {
    markdown = markdown.replaceAll(
      shortcode.token,
      `<!-- WordPress shortcode requires review: ${shortcode.name} -->`,
    );
  }
  markdown = markdown
    .replace(/\u00a0/g, ' ')
    .replace(/^(\s*)[-*+]\s+/gm, '$1- ')
    .replace(/^(\s*\d+\.)\s+/gm, '$1 ');
  return {
    markdown: markdown.replace(/\n{3,}/g, '\n\n').trim(),
    shortcodes: shortcodes.map(({ name, original }) => ({ name, original })),
  };
}
