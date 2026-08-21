#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';
import { WooCommerceClient } from './lib/api.mjs';
import { runContentRepair } from './lib/content-repair.mjs';
import { extractContentImages, htmlToMarkdown } from './lib/markdown.mjs';
import { imageUrlKey, materializeImage } from './lib/images.mjs';
import {
  buildFrontmatter,
  priceDataForProduct,
  safeVariationForReport,
  selectStandardLicenseVariation,
} from './lib/products.mjs';
import {
  createReportState,
  finalizeReport,
  writeReports,
} from './lib/reports.mjs';
import {
  PATHS,
  PROJECT_ROOT,
  ensureDirectories,
  parseCliArgs,
  parsePermalink,
  redactConfiguredCredentials,
  redactSensitiveUrl,
  relativeProjectPath,
  renderMarkdown,
  safeProductFileStem,
  sanitizeError,
  splitFrontmatter,
  validateEnvironment,
  writeJsonAtomic,
  writeTextAtomic,
} from './lib/utils.mjs';
import { findProductVideos, mergeYouTubeVideos } from './lib/videos.mjs';

dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), quiet: true });

function assertNodeVersion() {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (major < 20) throw new Error('Node.js 20 or newer is required.');
}

async function loadExistingProducts(state) {
  const entries = [];
  const files = await fs.readdir(PATHS.products, { withFileTypes: true });
  for (const file of files) {
    if (!file.isFile() || path.extname(file.name).toLowerCase() !== '.md') continue;
    const filePath = path.join(PATHS.products, file.name);
    try {
      const parsed = splitFrontmatter(await fs.readFile(filePath, 'utf8'));
      entries.push({
        filePath,
        fileName: file.name,
        data: parsed.data,
        body: parsed.body,
      });
    } catch (error) {
      state.warnings.push({
        type: 'invalid_existing_frontmatter',
        file: relativeProjectPath(filePath),
        message: String(error?.message || 'Existing frontmatter could not be parsed.'),
      });
    }
  }
  return entries;
}

function findDuplicateValues(products, selector) {
  const groups = new Map();
  for (const product of products) {
    const value = selector(product);
    if (!value) continue;
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(product);
  }
  return [...groups.entries()].filter(([, items]) => items.length > 1);
}

function recordInputDuplicates(products, state) {
  for (const [slug, items] of findDuplicateValues(products, (product) => String(product?.slug ?? ''))) {
    state.duplicateSlugs.push({
      slug,
      products: items.map((product) => ({
        wordpress_id: product.id,
        product_name: String(product.name ?? ''),
      })),
    });
  }

  const parsed = products.map((product) => ({
    product,
    legacyUrl: parsePermalink(product?.permalink).legacyUrl,
  }));
  for (const [legacyUrl, items] of findDuplicateValues(parsed, (item) => item.legacyUrl)) {
    state.duplicateUrls.push({
      legacy_url: legacyUrl,
      products: items.map(({ product }) => ({
        wordpress_id: product.id,
        product_name: String(product.name ?? ''),
        slug: String(product.slug ?? ''),
      })),
    });
  }
}

function chooseOutputStem(product, duplicateSlugs) {
  const initial = safeProductFileStem(product?.slug, product?.id);
  if (!product?.slug || duplicateSlugs.has(String(product.slug))) {
    return `${initial}-${product.id}`;
  }
  return initial;
}

function reportWarning(state, product, type, message, extra = {}) {
  state.warnings.push({
    type,
    wordpress_id: product?.id ?? null,
    slug: String(product?.slug ?? ''),
    message,
    ...extra,
  });
}

async function processProduct(context, product, index) {
  const {
    client,
    currency,
    duplicateSlugs,
    existingById,
    existingBySlug,
    options,
    rawVariations,
    state,
    totalToProcess,
    urlMap,
  } = context;
  const title = String(product?.name ?? `Product #${product?.id ?? 'unknown'}`);
  console.log(`[${index + 1}/${totalToProcess}] ${title}`);
  state.summary.products_processed += 1;

  if (product?.type === 'variable') state.summary.variable_products += 1;
  else if (product?.type === 'simple') state.summary.simple_products += 1;
  else {
    reportWarning(
      state,
      product,
      'unsupported_product_type',
      `WooCommerce product type "${String(product?.type ?? '')}" is neither simple nor variable; prices were left empty.`,
    );
  }

  const existing =
    existingById.get(String(product?.id)) ||
    (existingBySlug.get(String(product?.slug ?? ''))?.data?.wordpress_id == null
      ? existingBySlug.get(String(product?.slug ?? ''))
      : null);
  const outputStem = chooseOutputStem(product, duplicateSlugs);
  const outputPath = path.join(PATHS.products, `${outputStem}.md`);
  const mediaDirectory = path.join(PATHS.mediaProducts, outputStem);
  const permalink = parsePermalink(product?.permalink);
  if (permalink.error) {
    reportWarning(state, product, 'invalid_permalink', permalink.error, {
      source_url: permalink.sourceUrl,
    });
  }
  if (!product?.slug) {
    reportWarning(
      state,
      product,
      'missing_slug',
      `Product was exported using fallback file stem "${outputStem}".`,
    );
  }

  if (existing && String(existing.data?.slug ?? '') !== String(product?.slug ?? '')) {
    const slugChange = {
      wordpress_id: product.id,
      old_slug: String(existing.data?.slug ?? ''),
      new_slug: String(product?.slug ?? ''),
      old_file: relativeProjectPath(existing.filePath),
      new_file: relativeProjectPath(outputPath),
      old_url: String(existing.data?.legacy_url ?? existing.data?.permalink ?? ''),
      new_url: permalink.legacyUrl,
    };
    state.slugChanges.push(slugChange);
    if (slugChange.old_url !== slugChange.new_url) {
      reportWarning(state, product, 'redirect_required', 'The legacy product URL changed.', {
        old_url: slugChange.old_url,
        new_url: slugChange.new_url,
      });
    }
  }

  let variations = [];
  let selection = null;
  if (product?.type === 'variable') {
    try {
      variations = await client.fetchVariations(product.id);
      rawVariations[String(product.id)] = variations;
      selection = selectStandardLicenseVariation(variations);
    } catch (error) {
      rawVariations[String(product.id)] = [];
      selection = { status: 'missing', variation: null, label: '' };
      reportWarning(state, product, 'variation_fetch_failed', sanitizeError(error).message);
    }

    if (selection.status === 'found') {
      state.summary.standard_license_variations_found += 1;
      console.log(`  ✓ Standard License variation found: #${selection.variation.id}`);
      console.log(`  ✓ Standard License price: ${selection.variation.price}${currency ? ` ${currency}` : ''}`);
    } else if (selection.status === 'duplicate') {
      state.summary.standard_license_variations_duplicate += 1;
      state.duplicateStandard.push({
        wordpress_id: product.id,
        product_name: title,
        slug: String(product.slug ?? ''),
        matching_variations: selection.matches,
        available_variations: variations.map(safeVariationForReport),
      });
      console.log('  ⚠ Multiple equally strong Standard License variations found; price left empty');
    } else {
      state.summary.standard_license_variations_missing += 1;
      state.missingStandard.push({
        wordpress_id: product.id,
        product_name: title,
        slug: String(product.slug ?? ''),
        available_variations: variations.map(safeVariationForReport),
      });
      console.log('  ⚠ Standard License variation not found; price left empty');
    }
  }

  const pricing = priceDataForProduct(product, selection);
  const videoResult = await findProductVideos(product, { pageUrl: permalink.sourceUrl });
  if (videoResult.pageScanned) state.summary.video_page_scans += 1;
  if (videoResult.pageScanError) {
    state.summary.video_page_scan_failures += 1;
    reportWarning(
      state,
      product,
      'product_page_video_scan_failed',
      sanitizeError(videoResult.pageScanError).message,
    );
  }
  if (videoResult.videos.length) {
    state.summary.products_with_video += 1;
    state.summary.videos_found += videoResult.videos.length;
    for (const video of videoResult.videos) {
      state.videoSources.push({
        wordpress_id: product.id,
        slug: String(product.slug ?? ''),
        video_id: video.id,
        source: videoResult.source,
      });
    }
    console.log(
      `  ✓ ${videoResult.videos.length} YouTube video${videoResult.videos.length === 1 ? '' : 's'} found (${videoResult.source})`,
    );
  }
  const remoteToLocal = new Map();
  const productImages = Array.isArray(product?.images) ? product.images : [];
  let cover = '';
  const gallery = [];
  for (let imageIndex = 0; imageIndex < productImages.length; imageIndex += 1) {
    const url = String(productImages[imageIndex]?.src ?? '').trim();
    if (!url) continue;
    const key = imageUrlKey(url);
    if (remoteToLocal.has(key)) {
      if (imageIndex === 0) cover = remoteToLocal.get(key);
      else gallery.push(remoteToLocal.get(key));
      continue;
    }
    const baseName = imageIndex === 0 ? 'cover' : `image-${String(imageIndex).padStart(2, '0')}`;
    const result = await materializeImage({
      url,
      directory: mediaDirectory,
      baseName,
      force: options.force,
      dryRun: options.dryRun,
      stats: state.summary,
      failedImages: state.failedImages,
      product,
    });
    if (result.path) {
      remoteToLocal.set(key, result.path);
      if (imageIndex === 0) cover = result.path;
      else gallery.push(result.path);
    }
    if (options.dryRun) {
      console.log(`  - Would download ${baseName} from ${redactSensitiveUrl(url)}`);
    }
  }
  if (productImages.length === 0) {
    reportWarning(state, product, 'missing_product_image', 'Product does not have a cover image.');
  } else if (!cover && !options.dryRun) {
    reportWarning(state, product, 'missing_cover_after_download', 'Product cover could not be downloaded.');
  }

  const contentImages = extractContentImages(
    `${String(product?.short_description ?? '')}\n${String(product?.description ?? '')}`,
  );
  let contentCounter = 0;
  for (const contentImage of contentImages) {
    const key = imageUrlKey(contentImage.url);
    if (remoteToLocal.has(key)) continue;
    contentCounter += 1;
    const baseName = `content-image-${String(contentCounter).padStart(2, '0')}`;
    const result = await materializeImage({
      url: contentImage.url,
      directory: mediaDirectory,
      baseName,
      force: options.force,
      dryRun: options.dryRun,
      stats: state.summary,
      failedImages: state.failedImages,
      product,
    });
    if (result.path) remoteToLocal.set(key, result.path);
    if (options.dryRun) {
      console.log(`  - Would download ${baseName} from ${redactSensitiveUrl(contentImage.url)}`);
    }
  }

  const replacements = new Map();
  for (const [remote, local] of remoteToLocal) {
    replacements.set(remote, local);
    try {
      replacements.set(new URL(remote).toString(), local);
    } catch {
      // The original key remains available for non-standard URLs.
    }
  }
  const converted = htmlToMarkdown(product?.description, replacements);
  const convertedShortDescription = htmlToMarkdown(
    product?.short_description,
    replacements,
  );
  const excerpt =
    convertedShortDescription.markdown ||
    converted.markdown ||
    String(existing?.data?.excerpt ?? '');
  const videos = mergeYouTubeVideos(existing?.data?.videos, videoResult.videos);
  if (!String(product?.description ?? '').trim()) {
    reportWarning(
      state,
      product,
      'missing_long_description',
      'WooCommerce product description is empty; the Markdown body was left empty.',
    );
  }
  if (!excerpt) {
    reportWarning(
      state,
      product,
      'missing_short_description',
      'WooCommerce short description is empty; description or existing excerpt fallback was used.',
    );
  }
  for (const shortcode of [...convertedShortDescription.shortcodes, ...converted.shortcodes]) {
    state.shortcodes.push({
      wordpress_id: product.id,
      slug: String(product.slug ?? ''),
      shortcode: shortcode.name,
      original: shortcode.original,
    });
  }

  const frontmatter = buildFrontmatter(
    product,
    {
      sourceUrl: permalink.sourceUrl,
      legacyUrl: permalink.legacyUrl,
      pricing,
      currency,
      excerpt,
      cover,
      gallery,
      videos,
    },
    existing?.data,
  );

  urlMap.push({
    wordpress_id: product.id,
    slug: String(product.slug ?? ''),
    source_url: permalink.sourceUrl,
    legacy_url: permalink.legacyUrl,
    new_url: permalink.legacyUrl,
  });

  if (options.dryRun) {
    console.log(`  ✓ Would ${existing ? 'update' : 'create'} ${relativeProjectPath(outputPath)}`);
    if (existing?.data?.gumroad_url) console.log('  ✓ Existing Gumroad URL would be preserved');
    return;
  }

  await writeTextAtomic(outputPath, renderMarkdown(frontmatter, converted.markdown));
  if (existing && path.resolve(existing.filePath) !== path.resolve(outputPath)) {
    await fs.unlink(existing.filePath);
  }
  if (existing) {
    state.summary.products_updated += 1;
    console.log('  ✓ Markdown updated');
    if (existing.data?.gumroad_url) console.log('  ✓ Existing Gumroad URL preserved');
  } else {
    state.summary.products_created += 1;
    console.log('  ✓ Markdown created');
  }
}

async function main() {
  assertNodeVersion();
  const options = parseCliArgs(process.argv.slice(2));
  await ensureDirectories({ dryRun: options.dryRun });
  if (options.repairContent) {
    await runContentRepair(options);
    return;
  }
  const environment = validateEnvironment(process.env);
  const state = createReportState(options);
  const client = new WooCommerceClient(environment);

  let fetched;
  try {
    fetched = await client.fetchProducts(options.limit);
  } catch (error) {
    const safe = sanitizeError(error);
    console.error(safe.message);
    process.exitCode = safe.status === 401 || safe.status === 403 ? 3 : 2;
    return;
  }

  console.log('WooCommerce connection successful');
  console.log(`Found ${fetched.total} published products${options.limit ? `; processing first ${fetched.items.length}` : ''}`);
  state.summary.products_found = fetched.total;

  let currency = '';
  try {
    currency = await client.fetchStoreCurrency();
  } catch {
    // Store settings may be unavailable with read-only keys; the configured fallback is used.
  }
  currency ||= environment.currency;
  if (!currency) {
    state.warnings.push({
      type: 'missing_currency',
      message: 'Store currency could not be read and WOOCOMMERCE_CURRENCY is not configured.',
    });
  }

  const existingProducts = await loadExistingProducts(state);
  const existingById = new Map(
    existingProducts
      .filter((entry) => entry.data?.wordpress_id != null)
      .map((entry) => [String(entry.data.wordpress_id), entry]),
  );
  const existingBySlug = new Map(
    existingProducts
      .filter((entry) => typeof entry.data?.slug === 'string')
      .map((entry) => [entry.data.slug, entry]),
  );

  recordInputDuplicates(fetched.items, state);
  const duplicateSlugs = new Set(state.duplicateSlugs.map(({ slug }) => slug));
  const rawVariations = {};
  const urlMap = [];
  const context = {
    client,
    currency,
    duplicateSlugs,
    existingById,
    existingBySlug,
    options,
    rawVariations,
    state,
    totalToProcess: fetched.items.length,
    urlMap,
  };

  for (let index = 0; index < fetched.items.length; index += 1) {
    const product = fetched.items[index];
    try {
      await processProduct(context, product, index);
    } catch (error) {
      const safe = sanitizeError(error);
      state.failedProducts.push({
        wordpress_id: product?.id ?? null,
        product_name: String(product?.name ?? ''),
        slug: String(product?.slug ?? ''),
        error: safe.message,
      });
      console.log(`  ✗ Product failed: ${safe.message}`);
    }
  }

  if (options.limit === null) {
    const fetchedIds = new Set(fetched.items.map((product) => String(product.id)));
    state.missingProducts = existingProducts
      .filter(
        (entry) =>
          entry.data?.wordpress_id != null && !fetchedIds.has(String(entry.data.wordpress_id)),
      )
      .map((entry) => ({
        wordpress_id: entry.data.wordpress_id,
        slug: String(entry.data.slug ?? ''),
        file: relativeProjectPath(entry.filePath),
      }));
  }

  finalizeReport(state);
  if (!options.dryRun) {
    const credentials = [environment.consumerKey, environment.consumerSecret];
    await writeJsonAtomic(
      path.join(PATHS.raw, 'products.json'),
      redactConfiguredCredentials(fetched.items, credentials),
    );
    await writeJsonAtomic(
      path.join(PATHS.raw, 'product-variations.json'),
      redactConfiguredCredentials(rawVariations, credentials),
    );
    await writeJsonAtomic(path.join(PATHS.raw, 'import-metadata.json'), {
      source_site: environment.siteUrl,
      api_version: 'wc/v3',
      imported_at: state.summary.completed_at,
      product_count: fetched.items.length,
      dry_run: false,
      limit: options.limit,
    });
    await writeJsonAtomic(PATHS.urlMap, urlMap);
    await writeReports(state);
  }

  console.log('\nImport completed\n');
  console.log(`Products created: ${state.summary.products_created}`);
  console.log(`Products updated: ${state.summary.products_updated}`);
  console.log(`Products failed: ${state.summary.products_failed}\n`);
  console.log(`Standard License found: ${state.summary.standard_license_variations_found}`);
  console.log(`Standard License missing: ${state.summary.standard_license_variations_missing}`);
  console.log(`Standard License duplicate: ${state.summary.standard_license_variations_duplicate}\n`);
  console.log(`Images downloaded: ${state.summary.images_downloaded}`);
  console.log(`Images skipped: ${state.summary.images_skipped}`);
  console.log(`Images failed: ${state.summary.images_failed}`);
  console.log(`YouTube videos found: ${state.summary.videos_found}`);
  if (options.dryRun) console.log('\nDry run completed; no files were written.');
  else console.log('\nReport:\nmigration/reports/product-import-report.json');

  if (state.failedProducts.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(sanitizeError(error).message);
  process.exitCode = 2;
});
