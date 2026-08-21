import path from 'node:path';
import { writeJsonAtomic } from './utils.mjs';

export const POST_REPORT_FILES = {
  summary: 'post-import-report.json',
  failedPosts: 'failed-posts.json',
  failedImages: 'failed-post-images.json',
  cleanedBlocks: 'cleaned-post-blocks.json',
  shortcodes: 'post-shortcodes-found.json',
  duplicateSlugs: 'duplicate-post-slugs.json',
  duplicateUrls: 'duplicate-post-urls.json',
  slugChanges: 'post-slug-changes.json',
  missingPosts: 'missing-posts.json',
  routeConflicts: 'post-route-conflicts.json',
  emptyContent: 'empty-post-content.json',
  warnings: 'post-warnings.json',
};

export function createPostReportState(options) {
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
      slug: options.slug,
      posts_found: 0,
      posts_processed: 0,
      posts_created: 0,
      posts_updated: 0,
      posts_skipped: 0,
      posts_failed: 0,
      featured_images_found: 0,
      content_images_found: 0,
      images_downloaded: 0,
      images_skipped: 0,
      images_failed: 0,
      covers_downloaded: 0,
      content_images_downloaded: 0,
      youtube_videos_found: 0,
      posts_with_youtube_videos: 0,
      shortcodes_found: 0,
      cleaned_blocks: 0,
      duplicate_slugs: 0,
      duplicate_urls: 0,
      route_conflicts: 0,
      empty_content: 0,
      warnings: 0,
    },
    failedPosts: [],
    failedImages: [],
    cleanedBlocks: [],
    shortcodes: [],
    duplicateSlugs: [],
    duplicateUrls: [],
    slugChanges: [],
    missingPosts: [],
    routeConflicts: [],
    emptyContent: [],
    warnings: [],
  };
}

export function finalizePostReport(state) {
  const completedAt = new Date();
  state.summary.completed_at = completedAt.toISOString();
  state.summary.duration_ms =
    completedAt.getTime() - state.startedAt.getTime();
  state.summary.posts_failed = state.failedPosts.length;
  state.summary.shortcodes_found = state.shortcodes.length;
  state.summary.cleaned_blocks = state.cleanedBlocks.reduce(
    (count, item) => count + item.removed_blocks.length,
    0,
  );
  state.summary.duplicate_slugs = state.duplicateSlugs.length;
  state.summary.duplicate_urls = state.duplicateUrls.length;
  state.summary.route_conflicts = state.routeConflicts.length;
  state.summary.empty_content = state.emptyContent.length;
  state.summary.warnings = state.warnings.length;
}

export async function writePostReports(state, reportsDirectory) {
  const reports = [
    [POST_REPORT_FILES.summary, state.summary],
    [POST_REPORT_FILES.failedPosts, state.failedPosts],
    [POST_REPORT_FILES.failedImages, state.failedImages],
    [POST_REPORT_FILES.cleanedBlocks, state.cleanedBlocks],
    [POST_REPORT_FILES.shortcodes, state.shortcodes],
    [POST_REPORT_FILES.duplicateSlugs, state.duplicateSlugs],
    [POST_REPORT_FILES.duplicateUrls, state.duplicateUrls],
    [POST_REPORT_FILES.slugChanges, state.slugChanges],
    [POST_REPORT_FILES.missingPosts, state.missingPosts],
    [POST_REPORT_FILES.routeConflicts, state.routeConflicts],
    [POST_REPORT_FILES.emptyContent, state.emptyContent],
    [POST_REPORT_FILES.warnings, state.warnings],
  ];
  await Promise.all(
    reports.map(([fileName, value]) =>
      writeJsonAtomic(path.join(reportsDirectory, fileName), value),
    ),
  );
}
