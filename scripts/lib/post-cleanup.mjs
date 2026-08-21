import * as cheerio from 'cheerio';

const AUTOMATED_BLOCK_SELECTORS = [
  '.jp-relatedposts',
  '.yarpp-related',
  '.yarpp-related-none',
  '.crp_related',
  '.related-posts',
  '.related_posts',
  '.related-articles',
  '.recommended-posts',
  '.recommended-articles',
  '.you-may-also-like',
  '.trending-posts',
  '.sharedaddy',
  '.sd-sharing-enabled',
  '.social-share',
  '.social-sharing',
  '.share-buttons',
  '.post-share',
  '.author-box',
  '.post-author-box',
  '.newsletter-signup',
  '.newsletter-cta',
  '.post-navigation',
  '.comment-form',
  '.comments-area',
  '[data-related-posts]',
  '[data-recommendations]',
  '[data-recommendation]',
  '[id*="related-post"]',
  '[id*="recommended-post"]',
];

const LABEL_TYPES = new Map([
  ['see also', 'see_also'],
  ['related posts', 'related_posts'],
  ['related articles', 'related_articles'],
  ['you may also like', 'you_may_also_like'],
  ['recommended', 'recommended'],
  ['trending', 'trending'],
  ['share', 'share'],
]);

function normalizedText(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function blockRecord($, element, type) {
  const node = $(element);
  return {
    type,
    text: node.text().replace(/\s+/g, ' ').trim().slice(0, 500),
    target_url: String(node.find('a[href]').first().attr('href') || ''),
  };
}

function selectorType(element) {
  const identity = `${element.attribs?.id || ''} ${element.attribs?.class || ''}`.toLowerCase();
  if (identity.includes('share')) return 'share';
  if (identity.includes('author')) return 'author_box';
  if (identity.includes('newsletter')) return 'newsletter';
  if (identity.includes('comment')) return 'comments';
  if (identity.includes('navigation')) return 'post_navigation';
  if (identity.includes('trending')) return 'trending';
  if (identity.includes('recommend')) return 'recommended';
  return 'related_posts';
}

function isCompactRecommendation(node) {
  const tag = String(node?.[0]?.tagName || '').toLowerCase();
  if (!['article', 'aside', 'div', 'figure', 'li', 'section', 'ul', 'ol'].includes(tag)) {
    return false;
  }
  const text = node.text().replace(/\s+/g, ' ').trim();
  return text.length <= 2_000 && node.find('a[href]').length > 0;
}

export function cleanPostHtml(html) {
  const $ = cheerio.load(String(html ?? ''), null, false);
  const removedBlocks = [];

  for (const selector of AUTOMATED_BLOCK_SELECTORS) {
    $(selector).each((_, element) => {
      if (!element.parent) return;
      removedBlocks.push(blockRecord($, element, selectorType(element)));
      $(element).remove();
    });
  }

  $('h2, h3, h4, h5, h6, p, strong').each((_, element) => {
    if (!element.parent) return;
    const node = $(element);
    const label = normalizedText(node.text());
    const type = LABEL_TYPES.get(label);
    if (!type) return;

    const directText = normalizedText(node.clone().children().remove().end().text());
    if (directText !== label || node.find('img').length) return;
    const next = node.next();
    const removed = blockRecord($, element, type);
    if (type !== 'share' && next.length && isCompactRecommendation(next)) {
      removed.target_url ||= String(next.find('a[href]').first().attr('href') || '');
      removed.text = `${removed.text} ${next.text().replace(/\s+/g, ' ').trim()}`.trim().slice(0, 500);
      next.remove();
    }
    removedBlocks.push(removed);
    node.remove();
  });

  $('script, style, template, form').remove();
  $('noscript').each((_, element) => {
    const node = $(element);
    if (!node.text().trim()) node.remove();
  });

  return {
    html: $.html(),
    removedBlocks,
  };
}
