import test from 'node:test';
import assert from 'node:assert/strict';
import { WooCommerceClient, WooCommerceApiError } from '../scripts/lib/api.mjs';

test('API uses a Basic header, never credential query parameters, and paginates', async (t) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    const page = Number(new URL(url).searchParams.get('page'));
    return new Response(JSON.stringify(page === 1 ? [{ id: 1 }] : [{ id: 2 }]), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-wp-total': '2',
        'x-wp-totalpages': '2',
      },
    });
  };

  const client = new WooCommerceClient({
    siteUrl: 'https://example.com',
    consumerKey: 'ck_test',
    consumerSecret: 'cs_test',
  });
  const result = await client.fetchProducts();
  assert.deepEqual(
    result.items.map(({ id }) => id),
    [1, 2],
  );
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.match(request.options.headers.Authorization, /^Basic /);
    assert.doesNotMatch(request.url, /consumer_(?:key|secret)/);
  }
});

test('authentication errors are not retried', async (t) => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => {
    requests += 1;
    return new Response('{}', { status: 401 });
  };

  const client = new WooCommerceClient({
    siteUrl: 'https://example.com',
    consumerKey: 'ck_test',
    consumerSecret: 'cs_test',
  });
  await assert.rejects(() => client.fetchProducts(1), WooCommerceApiError);
  assert.equal(requests, 1);
});
