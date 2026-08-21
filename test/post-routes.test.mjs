import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePostPermalink,
  validatePostPermalinks,
} from '../src/lib/post-urls.mjs';

function post(title, permalink, wordpressId = 1, legacyUrl = permalink) {
  return {
    id: `${wordpressId}.md`,
    data: {
      title,
      permalink,
      legacy_url: legacyUrl,
      wordpress_id: wordpressId,
    },
  };
}

test('blog permalink normalization preserves root paths and trailing slashes', () => {
  assert.deepEqual(normalizePostPermalink('/a-nested/post/'), {
    permalink: '/a-nested/post/',
    path: 'a-nested/post',
    hadDomain: false,
    hadQuery: false,
    hadFragment: false,
  });
});

test('absolute blog permalinks use only their safely encoded pathname', () => {
  assert.deepEqual(normalizePostPermalink('https://dirtybarn.com/café/?from=wp#top'), {
    permalink: '/caf%C3%A9/',
    path: 'caf%C3%A9',
    hadDomain: true,
    hadQuery: true,
    hadFragment: true,
  });
});

test('invalid and unsafe blog permalink paths are rejected', () => {
  assert.throws(() => normalizePostPermalink('missing-leading-slash/'), /must start/);
  assert.throws(() => normalizePostPermalink('//example.com/post/'), /protocol-relative/);
  assert.throws(() => normalizePostPermalink('/broken//post/'), /invalid path/);
});

test('duplicate blog permalinks identify both posts', () => {
  assert.throws(
    () => validatePostPermalinks([post('First', '/same/', 1), post('Second', '/same/', 2)]),
    /Duplicate blog permalink detected:[\s\S]*First[\s\S]*Second/,
  );
});

test('reserved, blog-prefixed, and product-prefixed routes are rejected', () => {
  assert.throws(() => validatePostPermalinks([post('About post', '/about/')]), /route conflict/);
  assert.throws(() => validatePostPermalinks([post('Dirtykit post', '/dirtykit/')]), /route conflict/);
  assert.throws(() => validatePostPermalinks([post('Blog child', '/blog/child/')]), /route conflict/);
  assert.throws(() => validatePostPermalinks([post('Product child', '/p/item/')]), /route conflict/);
});
