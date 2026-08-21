import test from 'node:test';
import assert from 'node:assert/strict';
import { absoluteSiteUrl, productRoute, validateProductPermalinks } from '../src/lib/urls.mjs';

function product(title, permalink, legacyUrl = permalink) {
  return {
    id: `${title}.md`,
    data: { title, slug: title.toLowerCase().replaceAll(' ', '-'), permalink, legacy_url: legacyUrl },
  };
}

test('product routes preserve nested permalink paths', () => {
  assert.deepEqual(productRoute(product('Example', '/p/nested/example/')), {
    path: 'nested/example',
    permalink: '/p/nested/example/',
  });
});

test('duplicate product permalinks fail with both product names', () => {
  assert.throws(
    () =>
      validateProductPermalinks([
        product('Product A', '/p/example/'),
        product('Product B', '/p/example/'),
      ]),
    /Duplicate product permalink detected:[\s\S]*Product A[\s\S]*Product B/,
  );
});

test('invalid or non-product permalinks are rejected', () => {
  assert.throws(() => productRoute(product('Query', '/p/query/?x=1')), /query or fragment/);
  assert.throws(() => productRoute(product('Wrong root', '/products/item/')), /under \/p\//);
});

test('absolute URLs are only produced with a valid site URL', () => {
  assert.equal(
    absoluteSiteUrl('/p/example/', 'https://example.com'),
    'https://example.com/p/example/',
  );
  assert.equal(absoluteSiteUrl('/p/example/', ''), undefined);
});
