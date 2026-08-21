import { delay } from './utils.mjs';

const MAX_PAGES = 500;

export class WordPressApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'WordPressApiError';
    this.status = status;
  }
}

export function validateWordPressEnvironment(environment = process.env) {
  const rawSiteUrl =
    environment.WORDPRESS_URL?.trim() || environment.WOOCOMMERCE_URL?.trim();
  if (!rawSiteUrl) {
    throw new Error('WORDPRESS_URL or WOOCOMMERCE_URL is required.');
  }

  let siteUrl;
  try {
    siteUrl = new URL(rawSiteUrl);
  } catch {
    throw new Error('WORDPRESS_URL must be a valid absolute URL.');
  }
  if (!['http:', 'https:'].includes(siteUrl.protocol)) {
    throw new Error('WORDPRESS_URL must use HTTP or HTTPS.');
  }
  siteUrl.search = '';
  siteUrl.hash = '';
  siteUrl.pathname = siteUrl.pathname.replace(/\/+$/, '');

  const username = environment.WORDPRESS_USERNAME?.trim() || '';
  const applicationPassword =
    environment.WORDPRESS_APPLICATION_PASSWORD?.trim() || '';
  if (Boolean(username) !== Boolean(applicationPassword)) {
    throw new Error(
      'WORDPRESS_USERNAME and WORDPRESS_APPLICATION_PASSWORD must be configured together.',
    );
  }

  return {
    siteUrl: siteUrl.toString().replace(/\/$/, ''),
    username,
    applicationPassword,
  };
}

export class WordPressClient {
  constructor({
    siteUrl,
    username = '',
    applicationPassword = '',
    timeoutMs = 20_000,
  }) {
    this.siteUrl = siteUrl;
    this.timeoutMs = timeoutMs;
    this.authorization =
      username && applicationPassword
        ? `Basic ${Buffer.from(`${username}:${applicationPassword}`).toString('base64')}`
        : '';
    this.mediaCache = new Map();
    this.userCache = new Map();
    this.termCache = new Map();
  }

  async request(endpoint, query = {}) {
    const url = new URL(
      `/wp-json/wp/v2/${String(endpoint).replace(/^\/+/, '')}`,
      this.siteUrl,
    );
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }

    for (let attempt = 0; attempt <= 3; attempt += 1) {
      try {
        const headers = {
          Accept: 'application/json',
          'User-Agent': 'dirtybarn-wordpress-post-migrator/1.0',
        };
        if (this.authorization) headers.Authorization = this.authorization;
        const response = await fetch(url, {
          headers,
          redirect: 'follow',
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (response.ok) {
          return { data: await response.json(), headers: response.headers };
        }

        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt === 3) {
          const message =
            response.status === 401 || response.status === 403
              ? 'WordPress authentication failed.'
              : response.status === 429
                ? 'WordPress API rate limit was exceeded.'
                : `WordPress API request failed with HTTP ${response.status}.`;
          throw new WordPressApiError(message, response.status);
        }
      } catch (error) {
        if (error instanceof WordPressApiError) throw error;
        if (attempt === 3) {
          const timeout =
            error?.name === 'TimeoutError' || error?.name === 'AbortError';
          throw new WordPressApiError(
            timeout
              ? 'WordPress API request timed out.'
              : 'WordPress API connection failed.',
          );
        }
      }
      await delay(300 * 2 ** attempt);
    }
    throw new WordPressApiError('WordPress API request failed.');
  }

  async fetchPosts({ limit = null, slug = null } = {}) {
    const items = [];
    let total = null;
    let totalPages = null;
    const perPage = limit === null ? 100 : Math.min(100, limit);

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const { data, headers } = await this.request('posts', {
        status: 'publish',
        per_page: perPage,
        page,
        _embed: 1,
        orderby: 'date',
        order: 'asc',
        slug,
      });
      if (!Array.isArray(data)) {
        throw new WordPressApiError(
          'WordPress posts endpoint returned an unexpected response.',
        );
      }
      if (page === 1) {
        const parsedTotal = Number(headers.get('x-wp-total'));
        const parsedPages = Number(headers.get('x-wp-totalpages'));
        total = Number.isFinite(parsedTotal) ? parsedTotal : null;
        totalPages =
          Number.isInteger(parsedPages) && parsedPages > 0
            ? Math.min(parsedPages, MAX_PAGES)
            : null;
      }
      items.push(...data.filter((post) => post?.status === 'publish'));
      if (limit !== null && items.length >= limit) break;
      if (totalPages !== null && page >= totalPages) break;
      if (totalPages === null && data.length === 0) break;
    }

    return {
      items: limit === null ? items : items.slice(0, limit),
      total: total ?? items.length,
    };
  }

  async fetchMedia(mediaId) {
    const id = Number(mediaId);
    if (!Number.isInteger(id) || id <= 0) return null;
    if (!this.mediaCache.has(id)) {
      this.mediaCache.set(
        id,
        this.request(`media/${id}`)
          .then(({ data }) => data)
          .catch(() => null),
      );
    }
    return this.mediaCache.get(id);
  }

  async fetchMediaBatch(mediaIds) {
    const ids = [
      ...new Set(
        (Array.isArray(mediaIds) ? mediaIds : [])
          .map(Number)
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    ];
    const missing = ids.filter((id) => !this.mediaCache.has(id));
    for (let offset = 0; offset < missing.length; offset += 100) {
      const batch = missing.slice(offset, offset + 100);
      try {
        const { data } = await this.request('media', {
          include: batch.join(','),
          per_page: batch.length,
          orderby: 'include',
        });
        const found = new Map(
          (Array.isArray(data) ? data : []).map((media) => [
            Number(media.id),
            media,
          ]),
        );
        for (const id of batch) {
          this.mediaCache.set(id, Promise.resolve(found.get(id) || null));
        }
      } catch {
        for (const id of batch) {
          this.mediaCache.set(id, Promise.resolve(null));
        }
      }
    }
    return Promise.all(ids.map((id) => this.mediaCache.get(id)));
  }

  async fetchUser(userId) {
    const id = Number(userId);
    if (!Number.isInteger(id) || id <= 0) return null;
    if (!this.userCache.has(id)) {
      this.userCache.set(
        id,
        this.request(`users/${id}`, { context: 'view' })
          .then(({ data }) => data)
          .catch(() => null),
      );
    }
    return this.userCache.get(id);
  }

  async fetchTerms(taxonomy, ids) {
    const uniqueIds = [
      ...new Set(
        (Array.isArray(ids) ? ids : [])
          .map(Number)
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    ];
    if (!uniqueIds.length) return [];
    const missing = uniqueIds.filter(
      (id) => !this.termCache.has(`${taxonomy}:${id}`),
    );
    if (missing.length) {
      try {
        const { data } = await this.request(taxonomy, {
          include: missing.join(','),
          per_page: Math.min(100, missing.length),
          orderby: 'include',
        });
        for (const term of Array.isArray(data) ? data : []) {
          this.termCache.set(`${taxonomy}:${term.id}`, term);
        }
      } catch {
        // Missing term names are reported by the caller without failing the post.
      }
      for (const id of missing) {
        if (!this.termCache.has(`${taxonomy}:${id}`)) {
          this.termCache.set(`${taxonomy}:${id}`, null);
        }
      }
    }
    return uniqueIds
      .map((id) => this.termCache.get(`${taxonomy}:${id}`))
      .filter(Boolean);
  }
}
