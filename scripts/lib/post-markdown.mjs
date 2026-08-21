import * as cheerio from 'cheerio';
import { htmlToMarkdown } from './markdown.mjs';
import { cleanPostHtml } from './post-cleanup.mjs';
import { extractYouTubeVideos, parseYouTubeUrl } from './videos.mjs';

const SHORTCODE_PATTERN =
  /\[(?!\/)([A-Za-z][\w-]*)(?:\s[^\]\r\n]*)?\]([\s\S]*?)\[\/\1\]|\[(?!\/)([A-Za-z][\w-]*)(?:\s[^\]\r\n]*)?\]/gi;
const KNOWN_STANDALONE_SHORTCODES = new Set([
  'audio',
  'caption',
  'embed',
  'gallery',
  'playlist',
  'video',
]);
const IMAGE_ATTRIBUTES = ['src', 'data-src', 'data-lazy-src', 'data-original'];

export const POST_MANAGED_FIELDS = new Set([
  'title',
  'slug',
  'wordpress_id',
  'status',
  'source_url',
  'legacy_url',
  'permalink',
  'excerpt',
  'cover',
  'author',
  'categories',
  'tags',
  'videos',
  'published_at',
  'updated_at',
]);

function shortcodeToken(index) {
  return `CODEXPOSTSHORTCODENOTE${index}END`;
}

function cleanUrl(value) {
  return String(value ?? '').trim().replaceAll('&amp;', '&');
}

function sourceCandidates(value) {
  return String(value ?? '')
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/))
    .map(([url, descriptor]) => {
      const width = descriptor?.endsWith('w')
        ? Number.parseInt(descriptor, 10)
        : 0;
      const density = descriptor?.endsWith('x')
        ? Number.parseFloat(descriptor) * 10_000
        : 0;
      return {
        url: cleanUrl(url),
        score: Number.isFinite(width + density) ? width + density : 0,
      };
    })
    .filter(({ url }) => /^https?:\/\//i.test(url));
}

function bestImageUrl($, element) {
  const node = $(element);
  const candidates = [];
  for (const attribute of IMAGE_ATTRIBUTES) {
    const url = cleanUrl(node.attr(attribute));
    if (/^https?:\/\//i.test(url)) {
      candidates.push({ url, score: attribute === 'src' ? 1 : 2 });
    }
  }
  candidates.push(...sourceCandidates(node.attr('srcset')));
  const picture = node.closest('picture');
  picture.find('source').each((_, source) => {
    const sourceNode = $(source);
    candidates.push(...sourceCandidates(sourceNode.attr('srcset')));
    for (const attribute of IMAGE_ATTRIBUTES) {
      const url = cleanUrl(sourceNode.attr(attribute));
      if (/^https?:\/\//i.test(url)) candidates.push({ url, score: 2 });
    }
  });
  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.url || '';
}

function mediaIdForImage($, element) {
  const node = $(element);
  const className = String(node.attr('class') || '');
  const classMatch = className.match(/\bwp-image-(\d+)\b/);
  const dataId = Number(node.attr('data-id') || node.closest('[data-id]').attr('data-id'));
  if (classMatch) return Number(classMatch[1]);
  return Number.isInteger(dataId) && dataId > 0 ? dataId : null;
}

function captionForImage($, element) {
  const node = $(element);
  const figureCaption = node.closest('figure').find('figcaption').first().text().trim();
  if (figureCaption) return figureCaption;
  const wrapperCaption = node
    .closest('.wp-caption')
    .find('.wp-caption-text')
    .first()
    .text()
    .trim();
  return wrapperCaption;
}

export function decodeHtmlText(value) {
  const $ = cheerio.load(String(value ?? ''), null, false);
  return $.root().text().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

export function parsePostPermalink(link) {
  if (!link) {
    return {
      sourceUrl: '',
      legacyUrl: '',
      error: 'Post link is missing.',
    };
  }
  try {
    const url = new URL(String(link));
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Unsupported URL protocol.');
    }
    return {
      sourceUrl: `${url.origin}${url.pathname}`,
      legacyUrl: url.pathname,
      error: null,
    };
  } catch {
    return {
      sourceUrl: String(link),
      legacyUrl: '',
      error: 'Post link is invalid.',
    };
  }
}

export function safePostFileStem(slug, wordpressId) {
  const value = String(slug ?? '').normalize('NFKC').trim();
  if (
    value &&
    !value.includes('/') &&
    !value.includes('\\') &&
    value !== '.' &&
    value !== '..' &&
    /^[\p{L}\p{N}._-]+$/u.test(value)
  ) {
    return value;
  }
  return `post-${Number.isInteger(Number(wordpressId)) ? wordpressId : 'unknown'}`;
}

export function preparePostContent(sourceHtml) {
  const shortcodes = [];
  const reviewShortcodes = [];
  let tokenIndex = 0;
  const protectedBlocks = [];
  const protectionDocument = cheerio.load(String(sourceHtml ?? ''), null, false);
  protectionDocument('pre').each((_, element) => {
    const token = `CODEXPOSTPROTECTEDBLOCK${protectedBlocks.length}END`;
    protectedBlocks.push({
      token,
      html: protectionDocument.html(element),
    });
    protectionDocument(element).replaceWith(token);
  });
  protectionDocument('code').each((_, element) => {
    const token = `CODEXPOSTPROTECTEDBLOCK${protectedBlocks.length}END`;
    protectedBlocks.push({
      token,
      html: protectionDocument.html(element),
    });
    protectionDocument(element).replaceWith(token);
  });
  let tokenized = protectionDocument
    .html()
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(
    SHORTCODE_PATTERN,
    (original, pairedName, inner, standaloneName) => {
      const name = String(pairedName || standaloneName || '').toLowerCase();
      const bareStandalone =
        !pairedName && /^\[[A-Za-z][\w-]*\]$/.test(original);
      const parameterizedStandalone =
        !pairedName &&
        /^\[[A-Za-z][\w-]*\s+(?=[^\]]*(?:=|["']))[^\]]+\]$/.test(original);
      if (
        !pairedName &&
        !KNOWN_STANDALONE_SHORTCODES.has(name) &&
        (bareStandalone || !parameterizedStandalone)
      ) {
        return original;
      }
      shortcodes.push({ name, original });
      if (name === 'embed') {
        const video = extractYouTubeVideos(inner || original)[0];
        if (video) {
          return `<p><a href="https://www.youtube.com/watch?v=${video.id}">Watch video on YouTube</a></p>`;
        }
        const embeddedUrl = String(inner || '').trim();
        if (/^https?:\/\//i.test(embeddedUrl)) {
          return `<p><a href="${embeddedUrl.replaceAll('"', '&quot;')}">View embedded content</a></p>`;
        }
      }
      const token = shortcodeToken(tokenIndex);
      reviewShortcodes.push({ token, name });
      tokenIndex += 1;
      return token;
    },
    );
  for (const block of protectedBlocks) {
    tokenized = tokenized.replaceAll(block.token, block.html);
  }

  const videos = extractYouTubeVideos(sourceHtml).map(({ id }) => ({
    provider: 'youtube',
    id,
    url: `https://www.youtube.com/watch?v=${id}`,
  }));
  const cleaned = cleanPostHtml(tokenized);
  const $ = cheerio.load(cleaned.html, null, false);

  $('blockquote.tiktok-embed, blockquote.instagram-media, blockquote.twitter-tweet').each(
    (_, element) => {
      const node = $(element);
      const candidate =
        node.attr('cite') || node.find('a[href]').first().attr('href') || '';
      if (/^https?:\/\//i.test(candidate)) {
        const link = $('<a>View embedded content</a>').attr('href', candidate);
        node.replaceWith($('<p></p>').append(link));
      } else {
        node.remove();
      }
    },
  );

  $('iframe').each((_, element) => {
    const node = $(element);
    const candidate =
      node.attr('src') ||
      node.attr('data-src') ||
      node.attr('data-lazy-src') ||
      '';
    const video = parseYouTubeUrl(candidate);
    if (video) {
      node.replaceWith(
        `<p><a href="https://www.youtube.com/watch?v=${video.id}">Watch video on YouTube</a></p>`,
      );
      return;
    }
    if (/^https?:\/\//i.test(candidate)) {
      const link = $('<a>View embedded content</a>').attr('href', candidate);
      node.replaceWith($('<p></p>').append(link));
    } else {
      node.remove();
    }
  });

  const images = [];
  const seen = new Set();
  $('img').each((_, element) => {
    const node = $(element);
    const url = bestImageUrl($, element);
    if (!url) return;
    node.attr('src', url);
    node.removeAttr('srcset');
    node.removeAttr('sizes');
    for (const attribute of IMAGE_ATTRIBUTES.slice(1)) node.removeAttr(attribute);
    if (seen.has(url)) return;
    seen.add(url);
    images.push({
      url,
      alt: String(node.attr('alt') || '').trim(),
      caption: captionForImage($, element),
      media_id: mediaIdForImage($, element),
    });
  });

  return {
    html: $.html(),
    images,
    videos: [...new Map(videos.map((video) => [video.id, video])).values()],
    shortcodes,
    reviewShortcodes,
    removedBlocks: cleaned.removedBlocks,
  };
}

function applyImageDetails(html, imageDetails) {
  const $ = cheerio.load(String(html ?? ''), null, false);
  const detailsByUrl = new Map(
    (Array.isArray(imageDetails) ? imageDetails : []).map((image) => [
      image.url,
      image,
    ]),
  );
  $('img').each((_, element) => {
    const node = $(element);
    const url = cleanUrl(node.attr('src'));
    const details = detailsByUrl.get(url);
    if (!details) return;
    node.attr('alt', details.alt || '');
    if (!details.caption) return;
    const figure = node.closest('figure');
    if (figure.length) {
      if (!figure.find('figcaption').length) {
        figure.append($('<figcaption></figcaption>').text(details.caption));
      }
    } else {
      node.after($('<p><em></em></p>').find('em').text(details.caption).end());
    }
  });
  return $.html();
}

export function postHtmlToMarkdown(
  preparedHtml,
  imageReplacements = new Map(),
  imageDetails = [],
  reviewShortcodes = [],
) {
  const $ = cheerio.load(
    applyImageDetails(preparedHtml, imageDetails),
    null,
    false,
  );
  const preBlocks = [];
  $('pre').each((index, element) => {
    const content = $(element).text().replace(/\r\n?/g, '\n').replace(/\n+$/, '');
    const token = `CODEXPOSTPREFORMATTED${index}END`;
    preBlocks.push({ token, content });
    $(element).replaceWith(token);
  });
  const bracketedProse = [];
  const htmlForConversion = $.html().replace(
    /\[[^\]\r\n]+\]/g,
    (original) => {
      const token = `CODEXPOSTBRACKETEDPROSE${bracketedProse.length}END`;
      bracketedProse.push({ token, original: decodeHtmlText(original) });
      return token;
    },
  );
  const converted = htmlToMarkdown(
    htmlForConversion,
    imageReplacements,
  );
  let markdown = converted.markdown;
  for (const { token, content } of preBlocks) {
    const longestRun = Math.max(
      0,
      ...[...content.matchAll(/`+/g)].map((match) => match[0].length),
    );
    const fence = '`'.repeat(Math.max(3, longestRun + 1));
    markdown = markdown.replaceAll(
      token,
      `${fence}\n${content}\n${fence}`,
    );
  }
  for (const { token, original } of bracketedProse) {
    markdown = markdown.replaceAll(token, original);
  }
  for (const { token, name } of reviewShortcodes) {
    markdown = markdown.replaceAll(
      token,
      `<!-- WordPress shortcode requires review: ${name} -->`,
    );
  }
  return {
    markdown,
    shortcodes: converted.shortcodes,
  };
}

function excerptFromFirstParagraph(preparedHtml) {
  const $ = cheerio.load(String(preparedHtml ?? ''), null, false);
  let result = '';
  $('p').each((_, element) => {
    if (result) return;
    const text = $(element).text().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length >= 20 && !/^watch video on youtube$/i.test(text)) result = text;
  });
  return result;
}

function truncateExcerpt(value, maximumLength = 300) {
  const text = String(value ?? '').trim();
  if (text.length <= maximumLength) return text;
  const sliced = text.slice(0, maximumLength + 1);
  const boundary = sliced.lastIndexOf(' ');
  return `${sliced.slice(0, boundary > 160 ? boundary : maximumLength).trimEnd()}…`;
}

export function buildPostExcerpt(renderedExcerpt, preparedHtml) {
  const $ = cheerio.load(String(renderedExcerpt ?? ''), null, false);
  $('a').each((_, element) => {
    const text = $(element).text().replace(/\s+/g, ' ').trim();
    if (/^(continue reading|read more)\b/i.test(text)) $(element).remove();
  });
  let excerpt = $.root().text().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  excerpt = excerpt
    .replace(/\s*(?:continue reading|read more)(?:\s*[→»….-]*)?\s*$/i, '')
    .trim();
  if (!excerpt) excerpt = excerptFromFirstParagraph(preparedHtml);
  return truncateExcerpt(excerpt);
}

export function buildPostFrontmatter(post, details, existing = {}) {
  const managed = {
    title: decodeHtmlText(post?.title?.rendered),
    slug: String(post?.slug ?? ''),
    wordpress_id: post?.id ?? null,
    status: post?.status === 'publish' ? 'published' : String(post?.status ?? ''),
    source_url: details.sourceUrl,
    legacy_url: details.legacyUrl,
    permalink: details.legacyUrl,
    excerpt: details.excerpt,
    cover: details.cover,
    author: details.author,
    categories: details.categories,
    tags: details.tags,
    videos: details.videos,
    published_at: String(post?.date ?? ''),
    updated_at: String(post?.modified ?? ''),
  };
  for (const [key, value] of Object.entries(existing || {})) {
    if (!POST_MANAGED_FIELDS.has(key)) managed[key] = value;
  }
  return managed;
}
