import path from 'node:path';
import { PATHS, writeJsonAtomic } from './utils.mjs';

export const REPORT_FILES = {
  report: 'product-import-report.json',
  failedProducts: 'failed-products.json',
  failedImages: 'failed-images.json',
  shortcodes: 'shortcodes-found.json',
  duplicateSlugs: 'duplicate-slugs.json',
  duplicateUrls: 'duplicate-urls.json',
  missingStandard: 'missing-standard-license.json',
  duplicateStandard: 'duplicate-standard-license.json',
  slugChanges: 'slug-changes.json',
  missingProducts: 'missing-products.json',
  warnings: 'warnings.json',
  videoSources: 'product-videos.json',
};

export function createReportState(options) {
  const startedAt = new Date();
  return {
    startedAt,
    summary: {
      started_at: startedAt.toISOString(),
      completed_at: '',
      duration_ms: 0,
      dry_run: options.dryRun,
      force: options.force,
      limit: options.limit,
      products_found: 0,
      products_processed: 0,
      products_created: 0,
      products_updated: 0,
      products_skipped: 0,
      products_failed: 0,
      variable_products: 0,
      simple_products: 0,
      standard_license_variations_found: 0,
      standard_license_variations_missing: 0,
      standard_license_variations_duplicate: 0,
      images_found: 0,
      images_downloaded: 0,
      images_skipped: 0,
      images_failed: 0,
      shortcodes_found: 0,
      duplicate_slugs: 0,
      duplicate_urls: 0,
      slug_changes: 0,
      warnings: 0,
      videos_found: 0,
      products_with_video: 0,
      video_page_scans: 0,
      video_page_scan_failures: 0,
    },
    failedProducts: [],
    failedImages: [],
    shortcodes: [],
    duplicateSlugs: [],
    duplicateUrls: [],
    missingStandard: [],
    duplicateStandard: [],
    slugChanges: [],
    missingProducts: [],
    warnings: [],
    videoSources: [],
  };
}

export function finalizeReport(state) {
  const completedAt = new Date();
  state.summary.completed_at = completedAt.toISOString();
  state.summary.duration_ms = completedAt.getTime() - state.startedAt.getTime();
  state.summary.products_failed = state.failedProducts.length;
  state.summary.shortcodes_found = state.shortcodes.length;
  state.summary.duplicate_slugs = state.duplicateSlugs.length;
  state.summary.duplicate_urls = state.duplicateUrls.length;
  state.summary.slug_changes = state.slugChanges.length;
  state.summary.warnings = state.warnings.length;
}

export async function writeReports(state) {
  const entries = [
    [REPORT_FILES.report, state.summary],
    [REPORT_FILES.failedProducts, state.failedProducts],
    [REPORT_FILES.failedImages, state.failedImages],
    [REPORT_FILES.shortcodes, state.shortcodes],
    [REPORT_FILES.duplicateSlugs, state.duplicateSlugs],
    [REPORT_FILES.duplicateUrls, state.duplicateUrls],
    [REPORT_FILES.missingStandard, state.missingStandard],
    [REPORT_FILES.duplicateStandard, state.duplicateStandard],
    [REPORT_FILES.slugChanges, state.slugChanges],
    [REPORT_FILES.missingProducts, state.missingProducts],
    [REPORT_FILES.warnings, state.warnings],
    [REPORT_FILES.videoSources, state.videoSources],
  ];
  await Promise.all(
    entries.map(([fileName, value]) => writeJsonAtomic(path.join(PATHS.reports, fileName), value)),
  );
}
