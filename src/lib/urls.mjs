function productLabel(product) {
  return String(product?.data?.title || product?.id || 'Unknown product');
}

export function productRoute(product) {
  const title = productLabel(product);
  const slug = String(product?.data?.slug || '').trim();
  const permalink = String(product?.data?.permalink || '').trim();

  if (!slug) throw new Error(`Product "${title}" is missing a slug.`);
  if (!permalink) throw new Error(`Product "${title}" is missing a permalink.`);
  if (!permalink.startsWith('/') || permalink.startsWith('//')) {
    throw new Error(`Product "${title}" has an invalid permalink: ${permalink}`);
  }
  if (permalink.includes('?') || permalink.includes('#')) {
    throw new Error(`Product "${title}" permalink must not include a query or fragment: ${permalink}`);
  }
  if (!permalink.startsWith('/p/')) {
    throw new Error(`Product "${title}" permalink must be under /p/: ${permalink}`);
  }
  if (!permalink.endsWith('/')) {
    throw new Error(`Product "${title}" permalink must preserve a trailing slash: ${permalink}`);
  }

  const path = permalink.slice('/p/'.length, -1);
  if (!path || path.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Product "${title}" has an invalid /p/ route: ${permalink}`);
  }

  return { path, permalink };
}

export function validateProductPermalinks(products, { warn = console.warn } = {}) {
  const routes = [];
  const byPermalink = new Map();

  for (const product of products) {
    const route = productRoute(product);
    const existing = byPermalink.get(route.permalink);
    if (existing) {
      throw new Error(
        [
          'Duplicate product permalink detected:',
          route.permalink,
          '',
          'Products:',
          `- ${productLabel(existing)}`,
          `- ${productLabel(product)}`,
        ].join('\n'),
      );
    }
    byPermalink.set(route.permalink, product);

    const legacyUrl = String(product?.data?.legacy_url || '').trim();
    if (legacyUrl && legacyUrl !== route.permalink) {
      warn(
        `Product "${productLabel(product)}" has different legacy_url and permalink values: ` +
          `${legacyUrl} !== ${route.permalink}`,
      );
    }
    routes.push({ ...route, product });
  }

  return routes;
}

export function absoluteSiteUrl(pathname, siteUrl) {
  const base = String(siteUrl || '').trim();
  if (!base) return undefined;
  try {
    return new URL(pathname, base.endsWith('/') ? base : `${base}/`).toString();
  } catch {
    return undefined;
  }
}
