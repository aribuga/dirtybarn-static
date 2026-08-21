import * as cheerio from 'cheerio';
import { delay } from './utils.mjs';

const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const VIDEO_ATTRIBUTES = [
  'href',
  'src',
  'value',
  'content',
  'data-src',
  'data-url',
  'data-video',
  'data-video-url',
  'data-lazy-src',
  'data-lazyload',
  'data-orig-src',
  'data-original',
  'data-embed-src',
];

function cleanCandidate(value) {
  return String(value ?? '')
    .trim()
    .replaceAll('&amp;', '&')
    .replace(/^["']|["']$/g, '');
}

export function parseYouTubeUrl(value) {
  const candidate = cleanCandidate(value);
  if (!candidate) return null;

  let url;
  try {
    url = new URL(candidate.startsWith('//') ? `https:${candidate}` : candidate);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  let id = '';
  if (host === 'youtu.be') {
    id = url.pathname.split('/').filter(Boolean)[0] || '';
  } else if (
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'music.youtube.com' ||
    host === 'youtube-nocookie.com'
  ) {
    if (url.pathname === '/watch') id = url.searchParams.get('v') || '';
    else {
      const [kind, pathId] = url.pathname.split('/').filter(Boolean);
      if (['embed', 'shorts', 'live'].includes(kind)) id = pathId || '';
    }
  }

  if (!YOUTUBE_ID_PATTERN.test(id)) return null;
  return {
    provider: 'youtube',
    id,
    url: `https://www.youtube.com/watch?v=${id}`,
    embed_url: `https://www.youtube-nocookie.com/embed/${id}`,
  };
}

function collectStrings(value, output = [], seen = new Set()) {
  if (typeof value === 'string') {
    output.push(value);
    const trimmed = value.trim();
    if (/^[{[]/.test(trimmed)) {
      try {
        collectStrings(JSON.parse(trimmed), output, seen);
      } catch {
        // A regular string that resembles JSON is still inspected as-is.
      }
    }
    return output;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return output;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output, seen);
  } else {
    for (const item of Object.values(value)) collectStrings(item, output, seen);
  }
  return output;
}

function stringsFromHtml(html) {
  const $ = cheerio.load(String(html ?? ''), null, false);
  const values = [$.root().text()];
  $('*').each((_, element) => {
    for (const attribute of VIDEO_ATTRIBUTES) {
      const value = $(element).attr(attribute);
      if (value) values.push(value);
    }
  });
  return values;
}

function urlCandidates(value) {
  const candidates = [];
  for (const text of collectStrings(value)) {
    candidates.push(text, ...stringsFromHtml(text));
    const normalized = text.replaceAll('\\/', '/');
    candidates.push(
      ...normalized.matchAll(/(?:https?:)?\/\/[^\s"'<>\\]+/gi),
    );
  }
  return candidates.map((candidate) =>
    typeof candidate === 'string' ? candidate : candidate[0],
  );
}

export function extractYouTubeVideos(value) {
  const videos = [];
  const seen = new Set();
  for (const candidate of urlCandidates(value)) {
    const video = parseYouTubeUrl(candidate);
    if (!video || seen.has(video.id)) continue;
    seen.add(video.id);
    videos.push(video);
  }
  return videos;
}

function normalizedExistingVideo(value) {
  const directId = String(value?.id ?? '').trim();
  if (YOUTUBE_ID_PATTERN.test(directId)) {
    return {
      provider: 'youtube',
      id: directId,
      url: `https://www.youtube.com/watch?v=${directId}`,
      embed_url: `https://www.youtube-nocookie.com/embed/${directId}`,
    };
  }
  return parseYouTubeUrl(value?.url) || parseYouTubeUrl(value?.embed_url);
}

export function mergeYouTubeVideos(existingVideos, detectedVideos) {
  const merged = [];
  const seen = new Set();
  for (const candidate of [
    ...(Array.isArray(existingVideos) ? existingVideos : []),
    ...(Array.isArray(detectedVideos) ? detectedVideos : []),
  ]) {
    const video = normalizedExistingVideo(candidate);
    if (!video || seen.has(video.id)) continue;
    seen.add(video.id);
    merged.push(video);
  }
  return merged;
}

function addSourcedVideos(entries, seen, value, source) {
  for (const video of extractYouTubeVideos(value)) {
    if (seen.has(video.id)) continue;
    seen.add(video.id);
    entries.push({ ...video, source });
  }
}

function videosFromPageByElement(html) {
  const $ = cheerio.load(String(html ?? ''));
  const entries = [];
  const seen = new Set();
  const iframeValues = [];
  $('iframe').each((_, element) => {
    for (const attribute of VIDEO_ATTRIBUTES) {
      const value = $(element).attr(attribute);
      if (value) iframeValues.push(value);
    }
  });
  addSourcedVideos(entries, seen, iframeValues, 'product_page_iframe');

  const linkValues = [];
  $('a').each((_, element) => {
    for (const attribute of VIDEO_ATTRIBUTES) {
      const value = $(element).attr(attribute);
      if (value) linkValues.push(value);
    }
  });
  addSourcedVideos(entries, seen, linkValues, 'product_page_link');
  addSourcedVideos(entries, seen, html, 'product_page_html');
  return entries;
}

export async function findContentRepairVideos(
  product,
  { pageUrl = '', fetchPage = fetchProductPage } = {},
) {
  const entries = [];
  const seen = new Set();
  const metadata = Array.isArray(product?.meta_data) ? product.meta_data : [];
  for (const [key, source] of [
    ['nm-featured-video-link', 'woocommerce_meta_nm_featured_video_link'],
    ['_nm-featured-video-link', 'woocommerce_meta_private_nm_featured_video_link'],
  ]) {
    for (const item of metadata.filter((entry) => entry?.key === key)) {
      addSourcedVideos(entries, seen, item?.value, source);
    }
  }
  addSourcedVideos(
    entries,
    seen,
    product?.short_description,
    'woocommerce_short_description',
  );
  addSourcedVideos(entries, seen, product?.description, 'woocommerce_description');

  if (entries.length || !pageUrl) {
    return { entries, pageScanned: false, pageScanError: null };
  }

  try {
    const html = await fetchPage(pageUrl);
    return {
      entries: videosFromPageByElement(html),
      pageScanned: true,
      pageScanError: null,
    };
  } catch (error) {
    return { entries: [], pageScanned: true, pageScanError: error };
  }
}

function elementCandidates($, element) {
  const values = [];
  const nodes = [element, ...$(element).find('a, iframe, input, meta, source').toArray()];
  for (const node of nodes) {
    for (const attribute of VIDEO_ATTRIBUTES) {
      const value = $(node).attr(attribute);
      if (value) values.push(value);
    }
  }
  values.push($(element).text());
  return values;
}

function videosFromFeaturedElement(html) {
  const $ = cheerio.load(String(html ?? ''));
  const element = $('#nm-featured-video-link').first();
  return element.length ? extractYouTubeVideos(elementCandidates($, element[0])) : [];
}

function videosFromPageFallback(html) {
  const $ = cheerio.load(String(html ?? ''));
  const values = [];
  $('a[href], iframe[src]').each((_, element) => {
    const value = $(element).attr(element.tagName === 'iframe' ? 'src' : 'href');
    if (value) values.push(value);
  });
  return extractYouTubeVideos(values);
}

export async function fetchProductPage(url) {
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': 'dirtybarn-woocommerce-migrator/1.0',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) {
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.toLowerCase().includes('text/html')) {
          throw Object.assign(new Error('Product page did not return HTML.'), { retryable: false });
        }
        return await response.text();
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === 2) {
        throw Object.assign(
          new Error(`Product page request failed with HTTP ${response.status}.`),
          { retryable: false },
        );
      }
    } catch (error) {
      if (error?.retryable === false || attempt === 2) throw error;
    }
    await delay(300 * 2 ** attempt);
  }
  throw new Error('Product page request failed.');
}

function result(videos, source, pageScanned, pageScanError = null) {
  return { videos, source, pageScanned, pageScanError };
}

export async function findProductVideos(
  product,
  { pageUrl = '', fetchPage = fetchProductPage } = {},
) {
  const metadata = Array.isArray(product?.meta_data) ? product.meta_data : [];
  const metaSources = [
    ['nm-featured-video-link', 'woocommerce_meta_nm_featured_video_link'],
    ['_nm-featured-video-link', 'woocommerce_meta_private_nm_featured_video_link'],
  ];

  for (const [key, source] of metaSources) {
    for (const item of metadata.filter((entry) => entry?.key === key)) {
      const videos = extractYouTubeVideos(item?.value);
      if (videos.length) return result(videos, source, false);
    }
  }

  let pageHtml = '';
  let pageScanned = false;
  let pageScanError = null;
  if (pageUrl) {
    pageScanned = true;
    try {
      pageHtml = await fetchPage(pageUrl);
      const featuredVideos = videosFromFeaturedElement(pageHtml);
      if (featuredVideos.length) {
        return result(featuredVideos, 'product_page_nm_featured_video_link', true);
      }
    } catch (error) {
      pageScanError = error;
    }
  }

  const shortDescriptionVideos = extractYouTubeVideos(product?.short_description);
  if (shortDescriptionVideos.length) {
    return result(
      shortDescriptionVideos,
      'woocommerce_short_description',
      pageScanned,
      pageScanError,
    );
  }

  const descriptionVideos = extractYouTubeVideos(product?.description);
  if (descriptionVideos.length) {
    return result(
      descriptionVideos,
      'woocommerce_description',
      pageScanned,
      pageScanError,
    );
  }

  if (pageHtml) {
    const fallbackVideos = videosFromPageFallback(pageHtml);
    if (fallbackVideos.length) {
      return result(fallbackVideos, 'product_page_fallback', true, pageScanError);
    }
  }

  return result([], '', pageScanned, pageScanError);
}
