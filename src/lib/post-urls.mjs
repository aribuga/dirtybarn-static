export const RESERVED_BLOG_ROUTES = new Map([
  ['/', 'src/pages/index.astro'],
  ['/about/', 'src/pages/about.astro'],
  ['/blog/', 'src/pages/blog/index.astro'],
  ['/contact/', 'src/pages/contact.astro'],
  ['/dirtykit/', 'src/pages/dirtykit.astro'],
  ['/license/', 'src/pages/license.astro'],
  ['/privacy-policy/', 'src/pages/privacy-policy.astro'],
  ['/404.html', 'src/pages/404.astro'],
  ['/search-index.json', 'src/pages/search-index.json.ts'],
]);

function postLabel(post) {
  return String(post?.data?.title || post?.id || 'Unknown post');
}

function postId(post) {
  return post?.data?.wordpress_id ?? 'unknown';
}

function safeSegment(segment, permalink) {
  let decoded;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    throw new Error(`Blog permalink contains invalid URL encoding: ${permalink}`);
  }
  if (!decoded || decoded === '.' || decoded === '..' || decoded.includes('/')) {
    throw new Error(`Blog permalink contains an unsafe path segment: ${permalink}`);
  }
  return encodeURIComponent(decoded)
    .replaceAll('%3A', ':')
    .replaceAll('%40', '@');
}

export function normalizePostPermalink(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error('Blog permalink is missing.');
  if (raw.startsWith('//')) {
    throw new Error(`Blog permalink cannot be protocol-relative: ${raw}`);
  }

  const absolute = /^[a-z][a-z\d+.-]*:\/\//i.test(raw);
  if (!absolute && !raw.startsWith('/')) {
    throw new Error(`Blog permalink must start with "/": ${raw}`);
  }

  let parsed;
  try {
    parsed = new URL(raw, 'https://local.invalid');
  } catch {
    throw new Error(`Blog permalink is invalid: ${raw}`);
  }
  if (absolute && !['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Blog permalink uses an unsupported protocol: ${raw}`);
  }

  const pathname = parsed.pathname;
  if (!pathname.startsWith('/') || pathname.startsWith('//') || pathname.includes('//')) {
    throw new Error(`Blog permalink has an invalid path: ${raw}`);
  }
  if (pathname === '/') throw new Error('Blog permalink cannot use the site root.');

  const trailingSlash = pathname.endsWith('/');
  const segments = pathname.split('/').filter(Boolean);
  const normalized = `/${segments.map((segment) => safeSegment(segment, raw)).join('/')}${
    trailingSlash ? '/' : ''
  }`;

  return {
    permalink: normalized,
    path: normalized.slice(1).replace(/\/$/, ''),
    hadDomain: absolute,
    hadQuery: Boolean(parsed.search),
    hadFragment: Boolean(parsed.hash),
  };
}

function routeConflict(permalink, post, source) {
  return new Error(
    [
      `Blog route conflict detected: ${permalink}`,
      '',
      'Blog post:',
      `- ${postLabel(post)}`,
      `- wordpress_id: ${postId(post)}`,
      '',
      'Existing route:',
      `- ${source}`,
    ].join('\n'),
  );
}

export function validatePostPermalinks(
  posts,
  { warn = console.warn, existingRoutes = RESERVED_BLOG_ROUTES } = {},
) {
  const routes = [];
  const byPermalink = new Map();

  for (const post of posts) {
    let route;
    try {
      route = normalizePostPermalink(post?.data?.permalink);
    } catch (error) {
      throw new Error(
        [`Invalid blog permalink for "${postLabel(post)}" (wordpress_id: ${postId(post)}).`, error.message].join(
          '\n',
        ),
      );
    }

    const existingPost = byPermalink.get(route.permalink);
    if (existingPost) {
      throw new Error(
        [
          `Duplicate blog permalink detected: ${route.permalink}`,
          '',
          'Blog posts:',
          `- ${postLabel(existingPost)} (wordpress_id: ${postId(existingPost)})`,
          `- ${postLabel(post)} (wordpress_id: ${postId(post)})`,
        ].join('\n'),
      );
    }

    const reservedSource = existingRoutes.get(route.permalink);
    if (reservedSource) throw routeConflict(route.permalink, post, reservedSource);
    if (route.permalink.startsWith('/p/')) {
      throw routeConflict(route.permalink, post, 'src/pages/p/[...path].astro');
    }
    if (route.permalink.startsWith('/blog/')) {
      throw routeConflict(route.permalink, post, 'src/pages/blog/index.astro');
    }

    if (route.hadDomain) {
      warn(`Blog post "${postLabel(post)}" permalink included a domain; pathname is used.`);
    }
    if (route.hadQuery || route.hadFragment) {
      warn(`Blog post "${postLabel(post)}" permalink query or fragment was ignored.`);
    }

    const legacyUrl = String(post?.data?.legacy_url || '').trim();
    if (legacyUrl) {
      try {
        const legacy = normalizePostPermalink(legacyUrl).permalink;
        if (legacy !== route.permalink) {
          warn(
            `Blog post "${postLabel(post)}" has different legacy_url and permalink values: ` +
              `${legacy} !== ${route.permalink}`,
          );
        }
      } catch {
        warn(`Blog post "${postLabel(post)}" has an invalid legacy_url: ${legacyUrl}`);
      }
    }

    byPermalink.set(route.permalink, post);
    routes.push({ ...route, post });
  }

  return routes;
}
