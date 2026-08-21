import { delay } from './utils.mjs';

const MAX_PAGES = 1000;

export class WooCommerceApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'WooCommerceApiError';
    this.status = status;
  }
}

export class WooCommerceClient {
  constructor({ siteUrl, consumerKey, consumerSecret, timeoutMs = 20_000 }) {
    this.siteUrl = siteUrl;
    this.authorization = `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')}`;
    this.timeoutMs = timeoutMs;
  }

  async request(endpoint, query = {}) {
    const url = new URL(`/wp-json/wc/v3/${endpoint.replace(/^\/+/, '')}`, this.siteUrl);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    for (let attempt = 0; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: {
            Accept: 'application/json',
            Authorization: this.authorization,
            'User-Agent': 'dirtybarn-woocommerce-migrator/1.0',
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (response.ok) {
          const data = await response.json();
          return { data, headers: response.headers };
        }

        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt === 3) {
          const message =
            response.status === 401 || response.status === 403
              ? 'WooCommerce authentication failed.'
              : `WooCommerce API request failed with HTTP ${response.status}.`;
          throw new WooCommerceApiError(message, response.status);
        }
      } catch (error) {
        if (error instanceof WooCommerceApiError) throw error;
        if (attempt === 3) {
          const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
          throw new WooCommerceApiError(
            timeout ? 'WooCommerce API request timed out.' : 'WooCommerce API connection failed.',
          );
        }
      }
      await delay(300 * 2 ** attempt);
    }

    throw new WooCommerceApiError('WooCommerce API request failed.');
  }

  async fetchPaginated(endpoint, query = {}, limit = null) {
    const items = [];
    let total = null;
    let declaredPages = null;
    const perPage = limit === null ? 100 : Math.min(100, limit);

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const { data, headers } = await this.request(endpoint, {
        ...query,
        per_page: perPage,
        page,
      });
      if (!Array.isArray(data)) {
        throw new WooCommerceApiError('WooCommerce API returned an unexpected response.');
      }

      if (page === 1) {
        const parsedTotal = Number(headers.get('x-wp-total'));
        const parsedPages = Number(headers.get('x-wp-totalpages'));
        total = Number.isFinite(parsedTotal) ? parsedTotal : null;
        declaredPages =
          Number.isInteger(parsedPages) && parsedPages > 0 ? Math.min(parsedPages, MAX_PAGES) : null;
      }

      items.push(...data);
      if (limit !== null && items.length >= limit) break;
      if (declaredPages !== null && page >= declaredPages) break;
      if (declaredPages === null && data.length === 0) break;
    }

    return {
      items: limit === null ? items : items.slice(0, limit),
      total: total ?? items.length,
    };
  }

  fetchProducts(limit = null) {
    return this.fetchPaginated('products', { status: 'publish', orderby: 'date', order: 'asc' }, limit);
  }

  async fetchVariations(productId) {
    const { items } = await this.fetchPaginated(`products/${productId}/variations`);
    return items;
  }

  async fetchStoreCurrency() {
    const { data } = await this.request('settings/general');
    if (!Array.isArray(data)) return '';
    const setting = data.find((item) => item?.id === 'woocommerce_currency');
    return typeof setting?.value === 'string' ? setting.value.trim().toUpperCase() : '';
  }
}
