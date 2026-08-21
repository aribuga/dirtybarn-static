import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlToMarkdown, htmlToPlainText } from '../scripts/lib/markdown.mjs';
import {
  buildFrontmatter,
  priceDataForProduct,
  selectStandardLicenseVariation,
} from '../scripts/lib/products.mjs';
import {
  parsePermalink,
  parseCliArgs,
  redactConfiguredCredentials,
  redactSensitiveUrl,
  renderMarkdown,
} from '../scripts/lib/utils.mjs';
import { repairDescription } from '../scripts/lib/content-repair.mjs';

function variation(id, option, overrides = {}) {
  return {
    id,
    status: 'publish',
    purchasable: true,
    price: '12.00',
    regular_price: '15.00',
    sale_price: '12.00',
    attributes: [{ name: 'License', option }],
    ...overrides,
  };
}

test('selects the strongest exact Standard License match', () => {
  const selection = selectStandardLicenseVariation([
    variation(2, 'Standart Lisans'),
    variation(1, 'Standard License'),
  ]);
  assert.equal(selection.status, 'found');
  assert.equal(selection.variation.id, 1);
});

test('accepts short Standard only on a license attribute', () => {
  const accepted = selectStandardLicenseVariation([variation(1, 'Standard')]);
  const acceptedPlural = selectStandardLicenseVariation([
    {
      ...variation(3, 'Standard'),
      attributes: [{ name: 'Licences', option: 'Standard' }],
    },
  ]);
  const rejected = selectStandardLicenseVariation([
    {
      ...variation(2, 'Standard'),
      attributes: [{ name: 'Quality', option: 'Standard' }],
    },
  ]);
  assert.equal(accepted.status, 'found');
  assert.equal(acceptedPlural.status, 'found');
  assert.equal(rejected.status, 'missing');
});

test('rejects loose Standard matches and ineligible variations', () => {
  const selection = selectStandardLicenseVariation([
    variation(1, 'Standard + Extended'),
    variation(2, 'Standard Commercial'),
    variation(3, 'Standard License', { purchasable: false }),
    variation(4, 'Standard License', { price: '' }),
  ]);
  assert.equal(selection.status, 'missing');
});

test('reports equally strong duplicate Standard License matches', () => {
  const selection = selectStandardLicenseVariation([
    variation(1, 'Standard License'),
    variation(2, 'Standard License'),
  ]);
  assert.equal(selection.status, 'duplicate');
  assert.deepEqual(
    selection.matches.map(({ variation_id }) => variation_id),
    [1, 2],
  );
});

test('variable prices never fall back to parent product prices', () => {
  const pricing = priceDataForProduct(
    { type: 'variable', price: '1.00', regular_price: '2.00' },
    { status: 'missing' },
  );
  assert.equal(pricing.price, '');
  assert.equal(pricing.pricing_source, 'missing_standard_license_variation');
});

test('unsupported product types are not priced as simple products', () => {
  const pricing = priceDataForProduct({ type: 'external', price: '99.00' });
  assert.equal(pricing.price, '');
  assert.equal(pricing.pricing_source, 'unsupported_product_type');
});

test('custom frontmatter and gumroad_url are preserved', () => {
  const data = buildFrontmatter(
    { id: 1, name: 'Example', slug: 'example', type: 'simple', status: 'publish' },
    {
      sourceUrl: 'https://example.com/p/example/',
      legacyUrl: '/p/example/',
      pricing: priceDataForProduct({ type: 'simple', price: '10.00' }),
      currency: 'USD',
      excerpt: '',
      cover: '',
      gallery: [],
    },
    { gumroad_url: 'https://gumroad.com/example', featured: true, price: 'old' },
  );
  assert.equal(data.gumroad_url, 'https://gumroad.com/example');
  assert.equal(data.featured, true);
  assert.equal(data.price, '10.00');
});

test('permalink parsing removes query and fragment while preserving trailing slash', () => {
  assert.deepEqual(parsePermalink('https://example.com/p/item/?ref=old#details'), {
    sourceUrl: 'https://example.com/p/item/',
    legacyUrl: '/p/item/',
    error: null,
  });
});

test('HTML conversion strips scripts, keeps links, and reports shortcodes', () => {
  const converted = htmlToMarkdown(
    '<script>alert(1)</script><p><strong>Hello</strong> <a href="https://example.com">world</a></p>[gallery ids="1,2"]',
  );
  assert.doesNotMatch(converted.markdown, /alert/);
  assert.match(converted.markdown, /\*\*Hello\*\*/);
  assert.match(converted.markdown, /https:\/\/example\.com/);
  assert.match(converted.markdown, /WordPress shortcode requires review: gallery/);
  assert.equal(converted.shortcodes[0].name, 'gallery');
});

test('plain text excerpts remove unsafe markup and images', () => {
  assert.equal(
    htmlToPlainText('<p>Hello&nbsp; world</p><img src="x"><style>.x{}</style><script>x()</script>'),
    'Hello world',
  );
});

test('content repair keeps paragraphs, headings, lists, links, and entities as Markdown', () => {
  const repaired = repairDescription({
    short_description: `
      <p>First &amp; second paragraph.</p>
      <h2>Asset Specs</h2>
      <ul><li><strong>Bold item</strong></li><li><a href="https://example.com">Link</a></li></ul>
      <blockquote>Quoted&nbsp;text</blockquote>
    `,
    description: '<p>Fallback must not be used.</p>',
  });
  assert.equal(repaired.source, 'woocommerce_short_description');
  assert.match(repaired.excerpt, /First & second paragraph\./);
  assert.match(repaired.excerpt, /## Asset Specs/);
  assert.match(repaired.excerpt, /- \*\*Bold item\*\*/);
  assert.match(repaired.excerpt, /\[Link\]\(https:\/\/example\.com\)/);
  assert.match(repaired.excerpt, /> Quoted text/);
  assert.match(repaired.excerpt, /\n\n/);
});

test('content repair falls back to description and then existing excerpt', () => {
  assert.equal(
    repairDescription(
      { short_description: '<p> </p>', description: '<p>Long description</p>' },
      'Existing',
    ).excerpt,
    'Long description',
  );
  assert.deepEqual(repairDescription({}, 'Existing'), {
    excerpt: 'Existing',
    source: 'existing_frontmatter',
  });
});

test('multiline excerpts are written as YAML literal scalars', () => {
  const rendered = renderMarkdown(
    { title: 'Example', excerpt: 'First paragraph.\n\n- First\n- Second' },
    '',
  );
  assert.match(rendered, /excerpt: \|-\n  First paragraph\.\n  \n  - First\n  - Second/);
});

test('repair-content CLI option composes with dry-run and limit', () => {
  assert.deepEqual(parseCliArgs(['--repair-content', '--dry-run', '--limit', '3']), {
    dryRun: true,
    force: false,
    limit: 3,
    repairContent: true,
  });
});

test('credential redaction protects URLs and raw values', () => {
  assert.equal(
    redactSensitiveUrl('https://example.com/image.jpg?consumer_secret=sensitive&size=full'),
    'https://example.com/image.jpg?consumer_secret=%5Bredacted%5D&size=full',
  );
  assert.deepEqual(
    redactConfiguredCredentials({ nested: ['prefix-sensitive-suffix'] }, ['sensitive']),
    { nested: ['prefix-[redacted]-suffix'] },
  );
});
