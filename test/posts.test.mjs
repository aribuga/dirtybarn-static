import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WordPressClient,
  validateWordPressEnvironment,
} from '../scripts/lib/wordpress-api.mjs';
import { cleanPostHtml } from '../scripts/lib/post-cleanup.mjs';
import {
  buildPostExcerpt,
  buildPostFrontmatter,
  decodeHtmlText,
  parsePostPermalink,
  postHtmlToMarkdown,
  preparePostContent,
} from '../scripts/lib/post-markdown.mjs';

const VIDEO_ID = 'dQw4w9WgXcQ';

test('WordPress environment prefers WORDPRESS_URL and supports WooCommerce fallback', () => {
  assert.equal(
    validateWordPressEnvironment({
      WORDPRESS_URL: 'https://wordpress.example/path/',
      WOOCOMMERCE_URL: 'https://woo.example',
    }).siteUrl,
    'https://wordpress.example/path',
  );
  assert.equal(
    validateWordPressEnvironment({
      WOOCOMMERCE_URL: 'https://woo.example/',
    }).siteUrl,
    'https://woo.example',
  );
  assert.throws(
    () =>
      validateWordPressEnvironment({
        WORDPRESS_URL: 'https://example.com',
        WORDPRESS_USERNAME: 'user',
      }),
    /configured together/,
  );
});

test('WordPress posts paginate with header totals and never put credentials in URLs', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    const page = new URL(url).searchParams.get('page');
    const body =
      page === '1'
        ? [{ id: 1, status: 'publish' }, { id: 2, status: 'publish' }]
        : [{ id: 3, status: 'publish' }];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-WP-Total': '3',
        'X-WP-TotalPages': '2',
      },
    });
  };
  try {
    const client = new WordPressClient({
      siteUrl: 'https://example.com',
      username: 'user',
      applicationPassword: 'secret',
    });
    const result = await client.fetchPosts();
    assert.equal(result.total, 3);
    assert.deepEqual(result.items.map(({ id }) => id), [1, 2, 3]);
    assert.equal(requests.length, 2);
    assert.ok(requests.every(({ url }) => !url.includes('secret')));
    assert.ok(
      requests.every(
        ({ options }) =>
          options.headers.Authorization ===
          `Basic ${Buffer.from('user:secret').toString('base64')}`,
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('post cleanup removes targeted related wrappers but preserves normal prose', () => {
  const cleaned = cleanPostHtml(`
    <p>Please see also the explanation in this paragraph.</p>
    <aside class="jp-relatedposts"><h3>See also</h3><a href="/other/">Other</a></aside>
    <h2>Key Learnings</h2><p>Keep this.</p>
  `);
  assert.match(cleaned.html, /Please see also/);
  assert.match(cleaned.html, /Key Learnings/);
  assert.doesNotMatch(cleaned.html, /jp-relatedposts|Other/);
  assert.equal(cleaned.removedBlocks.length, 1);
  assert.equal(cleaned.removedBlocks[0].target_url, '/other/');
});

test('non-YouTube social embeds become normal links rather than raw embeds', () => {
  const prepared = preparePostContent(`
    <blockquote class="tiktok-embed" cite="https://www.tiktok.com/@artist/video/123">
      <a href="https://www.tiktok.com/@artist/video/123">TikTok</a>
    </blockquote>
  `);
  const converted = postHtmlToMarkdown(prepared.html);
  assert.match(
    converted.markdown,
    /\[View embedded content\]\(https:\/\/www\.tiktok\.com\/@artist\/video\/123\)/,
  );
  assert.doesNotMatch(converted.markdown, /!\[/);
});

test('plain bracketed prose and conditional HTML comments are not shortcodes', () => {
  const prepared = preparePostContent(`
    <!--[if lt IE 9]><script>legacy()</script><![endif]-->
    <p>Japanese title [OCHA] and track [zozo] remain intact.</p>
    <p>[Zozo &amp; Friends Take Over]</p>
  `);
  const converted = postHtmlToMarkdown(
    prepared.html,
    new Map(),
    [],
    prepared.reviewShortcodes,
  );
  assert.deepEqual(prepared.shortcodes, []);
  assert.match(converted.markdown, /\[OCHA\]/);
  assert.match(converted.markdown, /\[zozo\]/);
  assert.match(converted.markdown, /\[Zozo & Friends Take Over\]/);
  assert.doesNotMatch(converted.markdown, /legacy|shortcode requires review/);
});

test('post Markdown preserves paragraphs, lists, preformatted content, images, and video positions', () => {
  const prepared = preparePostContent(`
    <p>First paragraph.</p>
    <p>Second paragraph.</p>
    <h2>Key Learnings</h2>
    <ul><li>First item</li><li>Second item</li></ul>
    <pre>[PROJECT]-[DATE]
ROOT
├── CHILD
└── OTHER</pre>
    <figure><img class="wp-image-7" src="https://example.com/small.jpg"
      srcset="https://example.com/small.jpg 300w, https://example.com/large.jpg 1200w"
      alt="Diagram"><figcaption>Folder tree</figcaption></figure>
    <iframe data-src="https://www.youtube.com/embed/${VIDEO_ID}?rel=0"></iframe>
    [gallery ids="1,2"]
  `);
  const converted = postHtmlToMarkdown(
    prepared.html,
    new Map([
      ['https://example.com/large.jpg', '/media/posts/example/image-01.jpg'],
    ]),
    prepared.images,
    prepared.reviewShortcodes,
  );
  assert.match(converted.markdown, /First paragraph\.\n\nSecond paragraph\./);
  assert.match(converted.markdown, /## Key Learnings/);
  assert.match(converted.markdown, /- First item/);
  assert.match(converted.markdown, /```[\s\S]*├── CHILD[\s\S]*```/);
  assert.match(converted.markdown, /\[PROJECT\]-\[DATE\]/);
  assert.match(
    converted.markdown,
    /!\[Diagram\]\(\/media\/posts\/example\/image-01\.jpg\)/,
  );
  assert.match(converted.markdown, /Folder tree/);
  assert.match(
    converted.markdown,
    new RegExp(`\\[Watch video on YouTube\\]\\(https://www\\.youtube\\.com/watch\\?v=${VIDEO_ID}\\)`),
  );
  assert.match(
    converted.markdown,
    /WordPress shortcode requires review: gallery/,
  );
  assert.equal(prepared.images[0].url, 'https://example.com/large.jpg');
  assert.equal(prepared.videos[0].id, VIDEO_ID);
  assert.deepEqual(prepared.shortcodes.map(({ name }) => name), ['gallery']);
});

test('post title, excerpt, permalink, and custom frontmatter are normalized safely', () => {
  assert.equal(decodeHtmlText('2D &#038; 3D &#8217; Guide'), '2D & 3D ’ Guide');
  assert.deepEqual(
    parsePostPermalink('https://example.com/root-post/?ref=1#part'),
    {
      sourceUrl: 'https://example.com/root-post/',
      legacyUrl: '/root-post/',
      error: null,
    },
  );
  assert.equal(
    buildPostExcerpt(
      '<p>Short summary. <a href="/post/">Continue reading →</a></p>',
      '',
    ),
    'Short summary.',
  );
  const data = buildPostFrontmatter(
    {
      id: 9,
      slug: 'root-post',
      status: 'publish',
      title: { rendered: 'Root Post' },
    },
    {
      sourceUrl: 'https://example.com/root-post/',
      legacyUrl: '/root-post/',
      excerpt: 'Summary',
      cover: '',
      author: { id: 2, name: 'Author' },
      categories: [],
      tags: [],
      videos: [],
    },
    { featured: true, homepage_order: 4, title: 'Old title' },
  );
  assert.equal(data.title, 'Root Post');
  assert.equal(data.featured, true);
  assert.equal(data.homepage_order, 4);
});
