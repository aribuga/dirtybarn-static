import fs from 'node:fs/promises';
import path from 'node:path';
import { WooCommerceClient } from './api.mjs';
import { htmlToMarkdown } from './markdown.mjs';
import {
  PATHS,
  parsePermalink,
  relativeProjectPath,
  renderMarkdown,
  sanitizeError,
  splitFrontmatter,
  validateEnvironment,
  writeJsonAtomic,
  writeTextAtomic,
} from './utils.mjs';
import {
  findContentRepairVideos,
  mergeYouTubeVideos,
} from './videos.mjs';

const CONTENT_REPAIR_REPORTS = {
  summary: 'content-repair-report.json',
  videos: 'youtube-videos-found.json',
  pageFailures: 'youtube-page-scan-failures.json',
  emptyDescriptions: 'empty-descriptions.json',
};

async function loadExistingProducts() {
  const entries = [];
  for (const file of await fs.readdir(PATHS.products, { withFileTypes: true })) {
    if (!file.isFile() || path.extname(file.name).toLowerCase() !== '.md') continue;
    const filePath = path.join(PATHS.products, file.name);
    const source = await fs.readFile(filePath, 'utf8');
    const parsed = splitFrontmatter(source);
    entries.push({ filePath, source, ...parsed });
  }
  return entries;
}

async function loadRepairProducts(options, environment) {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(PATHS.raw, 'products.json'), 'utf8'));
    if (Array.isArray(raw) && raw.length) {
      return {
        products: options.limit === null ? raw : raw.slice(0, options.limit),
        total: raw.length,
        source: 'migration/raw/products.json',
      };
    }
  } catch (error) {
    if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }

  const validated = environment || validateEnvironment(process.env);
  const fetched = await new WooCommerceClient(validated).fetchProducts(options.limit);
  return { products: fetched.items, total: fetched.total, source: 'woocommerce_api' };
}

export function repairDescription(product, existingExcerpt = '') {
  const shortDescription = htmlToMarkdown(product?.short_description).markdown;
  if (shortDescription) {
    return { excerpt: shortDescription, source: 'woocommerce_short_description' };
  }
  const description = htmlToMarkdown(product?.description).markdown;
  if (description) {
    return { excerpt: description, source: 'woocommerce_description' };
  }
  return { excerpt: String(existingExcerpt ?? ''), source: 'existing_frontmatter' };
}

function renderWithPreservedBody(frontmatter, body) {
  const header = renderMarkdown(frontmatter, '').replace(/\n$/, '');
  return `${header}${String(body ?? '')}`;
}

function videoReportEntries(mergedVideos, detectedEntries) {
  const detectedById = new Map(detectedEntries.map((video) => [video.id, video.source]));
  return mergedVideos.map((video) => ({
    id: video.id,
    source: detectedById.get(video.id) || 'existing_frontmatter',
  }));
}

function isApiSource(source) {
  return String(source).startsWith('woocommerce_');
}

export async function runContentRepair(options, { environment } = {}) {
  const startedAt = new Date();
  const input = await loadRepairProducts(options, environment);
  const existingProducts = await loadExistingProducts();
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

  const summary = {
    started_at: startedAt.toISOString(),
    completed_at: '',
    duration_ms: 0,
    dry_run: options.dryRun,
    limit: options.limit,
    input_source: input.source,
    products_available: input.total,
    products_checked: 0,
    product_files_changed: 0,
    descriptions_repaired: 0,
    descriptions_unchanged: 0,
    empty_descriptions: 0,
    products_with_videos: 0,
    videos_found_from_api: 0,
    videos_found_from_page_scan: 0,
    videos_preserved_from_frontmatter: 0,
    total_unique_youtube_videos: 0,
    page_scans_attempted: 0,
    page_scans_failed: 0,
    unmatched_products: 0,
  };
  const videosFound = [];
  const pageScanFailures = [];
  const emptyDescriptions = [];
  const changedProducts = [];
  const allVideoIds = new Set();

  console.log(`Content repair input: ${input.source}`);
  console.log(`Products available: ${input.total}; checking ${input.products.length}`);

  for (let index = 0; index < input.products.length; index += 1) {
    const product = input.products[index];
    const existing =
      existingById.get(String(product?.id)) ||
      existingBySlug.get(String(product?.slug ?? ''));
    const title = String(product?.name ?? existing?.data?.title ?? `Product #${product?.id}`);
    console.log(`[${index + 1}/${input.products.length}] ${title}`);
    if (!existing) {
      summary.unmatched_products += 1;
      console.log('  - Existing Markdown product was not found; skipped');
      continue;
    }
    summary.products_checked += 1;

    const description = repairDescription(product, existing.data?.excerpt);
    const pageUrl =
      String(existing.data?.source_url ?? '').trim() ||
      parsePermalink(product?.permalink).sourceUrl;
    const videoResult = await findContentRepairVideos(product, { pageUrl });
    if (videoResult.pageScanned) summary.page_scans_attempted += 1;
    if (videoResult.pageScanError) {
      summary.page_scans_failed += 1;
      pageScanFailures.push({
        wordpress_id: product?.id ?? existing.data?.wordpress_id ?? null,
        title,
        slug: String(product?.slug ?? existing.data?.slug ?? ''),
        source_url: pageUrl,
        error: sanitizeError(videoResult.pageScanError).message,
      });
    }

    const detectedVideos = videoResult.entries.map(({ source, ...video }) => video);
    const mergedVideos = mergeYouTubeVideos(existing.data?.videos, detectedVideos);
    const sources = videoReportEntries(mergedVideos, videoResult.entries);
    const existingIds = new Set(
      mergeYouTubeVideos(existing.data?.videos, []).map((video) => video.id),
    );
    const detectedIds = new Set(videoResult.entries.map((video) => video.id));
    for (const video of sources) {
      allVideoIds.add(video.id);
      if (video.source === 'existing_frontmatter' || (
        existingIds.has(video.id) && !detectedIds.has(video.id)
      )) {
        summary.videos_preserved_from_frontmatter += 1;
      } else if (isApiSource(video.source)) {
        summary.videos_found_from_api += 1;
      } else if (video.source.startsWith('product_page_')) {
        summary.videos_found_from_page_scan += 1;
      }
    }

    if (mergedVideos.length) {
      summary.products_with_videos += 1;
      videosFound.push({
        wordpress_id: product?.id ?? existing.data?.wordpress_id ?? null,
        title,
        slug: String(product?.slug ?? existing.data?.slug ?? ''),
        videos: sources,
      });
    }

    const descriptionChanged = description.excerpt !== String(existing.data?.excerpt ?? '');
    if (descriptionChanged) summary.descriptions_repaired += 1;
    else summary.descriptions_unchanged += 1;
    if (!description.excerpt.trim()) {
      summary.empty_descriptions += 1;
      emptyDescriptions.push({
        wordpress_id: product?.id ?? existing.data?.wordpress_id ?? null,
        title,
        slug: String(product?.slug ?? existing.data?.slug ?? ''),
      });
    }

    const videosChanged =
      JSON.stringify(mergedVideos) !==
      JSON.stringify(mergeYouTubeVideos(existing.data?.videos, []));
    if (!descriptionChanged && !videosChanged) {
      console.log('  - Content unchanged');
      continue;
    }

    summary.product_files_changed += 1;
    changedProducts.push({
      wordpress_id: product?.id ?? existing.data?.wordpress_id ?? null,
      title,
      slug: String(product?.slug ?? existing.data?.slug ?? ''),
      file: relativeProjectPath(existing.filePath),
      description_changed: descriptionChanged,
      videos_changed: videosChanged,
      description_source: description.source,
      video_ids: mergedVideos.map((video) => video.id),
    });
    console.log(`  ✓ Description ${descriptionChanged ? 'would change' : 'unchanged'}`);
    console.log(`  ✓ Videos: ${mergedVideos.length}`);

    if (!options.dryRun) {
      const frontmatter = {
        ...existing.data,
        excerpt: description.excerpt,
        videos: mergedVideos,
      };
      await writeTextAtomic(
        existing.filePath,
        renderWithPreservedBody(frontmatter, existing.body),
      );
      console.log('  ✓ Content repaired');
    }
  }

  summary.total_unique_youtube_videos = allVideoIds.size;
  const completedAt = new Date();
  summary.completed_at = completedAt.toISOString();
  summary.duration_ms = completedAt.getTime() - startedAt.getTime();
  summary.changed_products = changedProducts;

  if (!options.dryRun) {
    await Promise.all([
      writeJsonAtomic(path.join(PATHS.reports, CONTENT_REPAIR_REPORTS.summary), summary),
      writeJsonAtomic(path.join(PATHS.reports, CONTENT_REPAIR_REPORTS.videos), videosFound),
      writeJsonAtomic(
        path.join(PATHS.reports, CONTENT_REPAIR_REPORTS.pageFailures),
        pageScanFailures,
      ),
      writeJsonAtomic(
        path.join(PATHS.reports, CONTENT_REPAIR_REPORTS.emptyDescriptions),
        emptyDescriptions,
      ),
    ]);
  }

  console.log('\nContent repair completed');
  console.log(`Descriptions repaired: ${summary.descriptions_repaired}`);
  console.log(`Descriptions unchanged: ${summary.descriptions_unchanged}`);
  console.log(`Empty descriptions: ${summary.empty_descriptions}`);
  console.log(`Products with videos: ${summary.products_with_videos}`);
  console.log(`Unique YouTube videos: ${summary.total_unique_youtube_videos}`);
  console.log(`Page scans failed: ${summary.page_scans_failed}`);
  if (options.dryRun) console.log('Dry run completed; no files or reports were written.');
  else console.log('Report: migration/reports/content-repair-report.json');

  return { summary, videosFound, pageScanFailures, emptyDescriptions };
}
