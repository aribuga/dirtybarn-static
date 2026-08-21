import { normalizeText } from './utils.mjs';

const LICENSE_ATTRIBUTE_NAMES = new Set(
  [
    'License',
    'Licence',
    'Licenses',
    'Licences',
    'License Type',
    'Licence Type',
    'Licensing',
    'Lisans',
    'Lisans Türü',
  ].map(normalizeText),
);

const FULL_MATCHES = new Map([
  [normalizeText('Standard License'), { priority: 1, label: 'Standard License' }],
  [normalizeText('Standard Licence'), { priority: 2, label: 'Standard Licence' }],
  [normalizeText('Standart Lisans'), { priority: 3, label: 'Standart Lisans' }],
]);

const SHORT_MATCHES = new Map([
  [normalizeText('Standard'), { priority: 4, label: 'Standard' }],
  [normalizeText('Standart'), { priority: 5, label: 'Standart' }],
]);

function variationMatch(variation) {
  let best = null;
  for (const attribute of Array.isArray(variation?.attributes) ? variation.attributes : []) {
    const name = normalizeText(attribute?.name);
    const option = normalizeText(attribute?.option);
    const full = FULL_MATCHES.get(option);
    const short = LICENSE_ATTRIBUTE_NAMES.has(name) ? SHORT_MATCHES.get(option) : null;
    const match = full || short;
    if (match && (!best || match.priority < best.priority)) {
      best = { ...match, sourceLabel: String(attribute?.option ?? '').trim() || match.label };
    }
  }
  return best;
}

export function selectStandardLicenseVariation(variations) {
  const eligible = (Array.isArray(variations) ? variations : [])
    .map((variation) => ({ variation, match: variationMatch(variation) }))
    .filter(
      ({ variation, match }) =>
        match &&
        variation?.status === 'publish' &&
        variation?.purchasable === true &&
        String(variation?.price ?? '').trim() !== '',
    );

  if (eligible.length === 0) return { status: 'missing', variation: null, label: '' };
  const strongestPriority = Math.min(...eligible.map(({ match }) => match.priority));
  const strongest = eligible.filter(({ match }) => match.priority === strongestPriority);
  if (strongest.length !== 1) {
    return {
      status: 'duplicate',
      variation: null,
      label: '',
      matches: strongest.map(({ variation, match }) => ({
        variation_id: variation.id,
        label: match.sourceLabel,
      })),
    };
  }
  return {
    status: 'found',
    variation: strongest[0].variation,
    label: strongest[0].match.sourceLabel,
  };
}

export function priceDataForProduct(product, selection) {
  if (product?.type === 'variable') {
    if (selection?.status === 'found') {
      return {
        price: String(selection.variation.price ?? ''),
        regular_price: String(selection.variation.regular_price ?? ''),
        sale_price: String(selection.variation.sale_price ?? ''),
        pricing_source: 'standard_license_variation',
        standard_license_variation_id: selection.variation.id,
        standard_license_label: selection.label,
      };
    }
    return {
      price: '',
      regular_price: '',
      sale_price: '',
      pricing_source:
        selection?.status === 'duplicate'
          ? 'duplicate_standard_license_variation'
          : 'missing_standard_license_variation',
      standard_license_variation_id: null,
      standard_license_label: '',
    };
  }

  if (product?.type === 'simple') {
    return {
      price: String(product?.price ?? ''),
      regular_price: String(product?.regular_price ?? ''),
      sale_price: String(product?.sale_price ?? ''),
      pricing_source: 'simple_product',
      standard_license_variation_id: null,
      standard_license_label: '',
    };
  }

  return {
    price: '',
    regular_price: '',
    sale_price: '',
    pricing_source: 'unsupported_product_type',
    standard_license_variation_id: null,
    standard_license_label: '',
  };
}

export function safeVariationForReport(variation) {
  return {
    variation_id: variation?.id ?? null,
    status: String(variation?.status ?? ''),
    purchasable: variation?.purchasable === true,
    attributes: (Array.isArray(variation?.attributes) ? variation.attributes : []).map((attribute) => ({
      name: String(attribute?.name ?? ''),
      option: String(attribute?.option ?? ''),
    })),
    price: String(variation?.price ?? ''),
  };
}

export const MANAGED_FIELDS = new Set([
  'title',
  'slug',
  'wordpress_id',
  'woocommerce_type',
  'status',
  'source_url',
  'legacy_url',
  'permalink',
  'price',
  'regular_price',
  'sale_price',
  'currency',
  'pricing_source',
  'standard_license_variation_id',
  'standard_license_label',
  'excerpt',
  'cover',
  'gallery',
  'videos',
  'categories',
  'tags',
  'published_at',
  'updated_at',
  'menu_order',
]);

export function buildFrontmatter(product, details, existing = {}) {
  const managed = {
    title: String(product?.name ?? ''),
    slug: String(product?.slug ?? ''),
    wordpress_id: product?.id ?? null,
    woocommerce_type: String(product?.type ?? ''),
    status: product?.status === 'publish' ? 'published' : String(product?.status ?? ''),
    source_url: details.sourceUrl,
    legacy_url: details.legacyUrl,
    permalink: details.legacyUrl,
    price: details.pricing.price,
    regular_price: details.pricing.regular_price,
    sale_price: details.pricing.sale_price,
    currency: details.currency,
    pricing_source: details.pricing.pricing_source,
    standard_license_variation_id: details.pricing.standard_license_variation_id,
    standard_license_label: details.pricing.standard_license_label,
    excerpt: details.excerpt,
    cover: details.cover,
    gallery: details.gallery,
    videos: details.videos ?? [],
    categories: (Array.isArray(product?.categories) ? product.categories : []).map(({ name }) =>
      String(name ?? ''),
    ),
    tags: (Array.isArray(product?.tags) ? product.tags : []).map(({ name }) => String(name ?? '')),
    gumroad_url: String(existing?.gumroad_url ?? ''),
    published_at: String(product?.date_created ?? ''),
    updated_at: String(product?.date_modified ?? ''),
    menu_order: Number(product?.menu_order) || 0,
  };

  for (const [key, value] of Object.entries(existing)) {
    if (!MANAGED_FIELDS.has(key) && key !== 'gumroad_url') managed[key] = value;
  }
  return managed;
}
