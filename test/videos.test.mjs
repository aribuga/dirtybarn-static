import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractYouTubeVideos,
  findContentRepairVideos,
  findProductVideos,
  mergeYouTubeVideos,
  parseYouTubeUrl,
} from '../scripts/lib/videos.mjs';

const FIRST_ID = 'dQw4w9WgXcQ';
const SECOND_ID = 'M7lc1UVf-VE';

test('parses supported YouTube URL forms into privacy-enhanced embeds', () => {
  for (const url of [
    `https://www.youtube.com/watch?v=${FIRST_ID}`,
    `https://youtu.be/${FIRST_ID}`,
    `https://www.youtube.com/embed/${FIRST_ID}`,
    `https://www.youtube.com/shorts/${FIRST_ID}`,
  ]) {
    const video = parseYouTubeUrl(url);
    assert.equal(video?.id, FIRST_ID);
    assert.equal(video?.embed_url, `https://www.youtube-nocookie.com/embed/${FIRST_ID}`);
  }
  assert.equal(parseYouTubeUrl('https://example.com/watch?v=dQw4w9WgXcQ'), null);
});

test('recursively inspects object, array, JSON, and HTML metadata values', () => {
  const videos = extractYouTubeVideos({
    nested: [
      `<a href="https://youtu.be/${FIRST_ID}">Watch</a>`,
      JSON.stringify({ url: `https://www.youtube.com/watch?v=${SECOND_ID}` }),
      `https://www.youtube.com/embed/${FIRST_ID}`,
    ],
  });
  assert.deepEqual(
    videos.map(({ id }) => id),
    [FIRST_ID, SECOND_ID],
  );
});

test('public metadata has highest priority and avoids product page scraping', async () => {
  let pageRequests = 0;
  const found = await findProductVideos(
    {
      meta_data: [
        {
          key: 'nm-featured-video-link',
          value: { links: [`https://youtu.be/${FIRST_ID}`] },
        },
      ],
      short_description: `https://youtu.be/${SECOND_ID}`,
    },
    {
      pageUrl: 'https://example.com/product/',
      fetchPage: async () => {
        pageRequests += 1;
        return '';
      },
    },
  );
  assert.equal(found.source, 'woocommerce_meta_nm_featured_video_link');
  assert.equal(found.videos[0].id, FIRST_ID);
  assert.equal(found.pageScanned, false);
  assert.equal(pageRequests, 0);
});

test('private metadata is used when the public metadata value is invalid', async () => {
  const found = await findProductVideos({
    meta_data: [
      { key: 'nm-featured-video-link', value: '' },
      { key: '_nm-featured-video-link', value: `https://youtu.be/${FIRST_ID}` },
    ],
  });
  assert.equal(found.source, 'woocommerce_meta_private_nm_featured_video_link');
  assert.equal(found.videos[0].id, FIRST_ID);
});

test('featured product page element precedes WooCommerce descriptions', async () => {
  const found = await findProductVideos(
    {
      meta_data: [],
      short_description: `<iframe src="https://www.youtube.com/embed/${SECOND_ID}"></iframe>`,
    },
    {
      pageUrl: 'https://example.com/product/',
      fetchPage: async () =>
        `<div id="nm-featured-video-link" data-video-url="https://youtu.be/${FIRST_ID}"></div>`,
    },
  );
  assert.equal(found.source, 'product_page_nm_featured_video_link');
  assert.equal(found.videos[0].id, FIRST_ID);
});

test('falls through short description, description, then page links', async () => {
  const fromShort = await findProductVideos(
    { short_description: `<a href="https://youtu.be/${FIRST_ID}">Video</a>` },
    { pageUrl: 'https://example.com', fetchPage: async () => '<html></html>' },
  );
  assert.equal(fromShort.source, 'woocommerce_short_description');

  const fromDescription = await findProductVideos(
    { description: `<iframe src="https://www.youtube.com/embed/${SECOND_ID}"></iframe>` },
    { pageUrl: 'https://example.com', fetchPage: async () => '<html></html>' },
  );
  assert.equal(fromDescription.source, 'woocommerce_description');

  const fromPage = await findProductVideos(
    {},
    {
      pageUrl: 'https://example.com',
      fetchPage: async () => `<a href="https://youtu.be/${FIRST_ID}">Watch</a>`,
    },
  );
  assert.equal(fromPage.source, 'product_page_fallback');
});

test('content repair collects all API videos and skips page scanning', async () => {
  let pageRequests = 0;
  const found = await findContentRepairVideos(
    {
      short_description: `<iframe data-src="https://www.youtube.com/embed/${FIRST_ID}?rel=0"></iframe>`,
      description: `[embed]https://youtu.be/${SECOND_ID}?list=example[/embed]`,
    },
    {
      pageUrl: 'https://example.com/product/',
      fetchPage: async () => {
        pageRequests += 1;
        return '';
      },
    },
  );
  assert.deepEqual(
    found.entries.map(({ id, source }) => ({ id, source })),
    [
      { id: FIRST_ID, source: 'woocommerce_short_description' },
      { id: SECOND_ID, source: 'woocommerce_description' },
    ],
  );
  assert.equal(found.pageScanned, false);
  assert.equal(pageRequests, 0);
});

test('content repair classifies lazy iframe, link, and HTML page sources', async () => {
  const found = await findContentRepairVideos(
    {},
    {
      pageUrl: 'https://example.com/product/',
      fetchPage: async () => `
        <iframe data-lazy-src="https://www.youtube-nocookie.com/embed/${FIRST_ID}"></iframe>
        <a href="https://youtu.be/${SECOND_ID}">Watch</a>
      `,
    },
  );
  assert.deepEqual(
    found.entries.map(({ id, source }) => ({ id, source })),
    [
      { id: FIRST_ID, source: 'product_page_iframe' },
      { id: SECOND_ID, source: 'product_page_link' },
    ],
  );
});

test('existing videos are safely merged and canonicalized by ID', () => {
  const merged = mergeYouTubeVideos(
    [{ provider: 'youtube', id: FIRST_ID, url: 'javascript:alert(1)', embed_url: 'bad' }],
    [
      parseYouTubeUrl(`https://youtu.be/${FIRST_ID}`),
      parseYouTubeUrl(`https://youtu.be/${SECOND_ID}`),
    ],
  );
  assert.deepEqual(
    merged.map(({ id, url, embed_url }) => ({ id, url, embed_url })),
    [
      {
        id: FIRST_ID,
        url: `https://www.youtube.com/watch?v=${FIRST_ID}`,
        embed_url: `https://www.youtube-nocookie.com/embed/${FIRST_ID}`,
      },
      {
        id: SECOND_ID,
        url: `https://www.youtube.com/watch?v=${SECOND_ID}`,
        embed_url: `https://www.youtube-nocookie.com/embed/${SECOND_ID}`,
      },
    ],
  );
});
