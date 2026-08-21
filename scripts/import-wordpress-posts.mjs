#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';
import {
  buildPostExcerpt,
  buildPostFrontmatter,
  decodeHtmlText,
  parsePostPermalink,
  postHtmlToMarkdown,
  preparePostContent,
  safePostFileStem,
} from './lib/post-markdown.mjs';
import {
  materializePostImage,
  postImageUrlKey,
} from './lib/post-images.mjs';
import {
  createPostReportState,
  finalizePostReport,
  writePostReports,
} from './lib/post-reports.mjs';
import {
  PROJECT_ROOT,
  relativeProjectPath,
  renderMarkdown,
  sanitizeError,
  splitFrontmatter,
  writeJsonAtomic,
  writeTextAtomic,
} from './lib/utils.mjs';
import {
  WordPressApiError,
  WordPressClient,
  validateWordPressEnvironment,
} from './lib/wordpress-api.mjs';

dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), quiet: true });

const POST_PATHS = {
  content: path.join(PROJECT_ROOT, 'content', 'posts'),
  media: path.join(PROJECT_ROOT, 'public', 'media', 'posts'),
  raw: path.join(PROJECT_ROOT, 'migration', 'raw'),
  reports: path.join(PROJECT_ROOT, 'migration', 'reports'),
  urlMap: path.join(PROJECT_ROOT, 'migration', 'post-url-map.json'),
};

const RESERVED_EXACT_PATHS = new Set([
  '/about/',
  '/contact/',
  '/dirtykit/',
  '/license/',
  '/privacy-policy/',
]);
const RESERVED_PREFIXES = ['/blog/', '/p/'];

function assertNodeVersion() {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (major < 20) throw new Error('Node.js 20 or newer is required.');
}

export function parsePostCliArgs(argv) {
  const options = { dryRun: false, force: false, limit: null, slug: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') {
      options.dryRun = true;
    } else if (argument === '--force') {
      options.force = true;
    } else if (argument === '--limit') {
      const value = argv[index + 1];
      if (!value || !/^[1-9]\d*$/.test(value)) {
        throw new Error('--limit must be a positive integer.');
      }
      options.limit = Number(value);
      index += 1;
    } else if (argument.startsWith('--limit=')) {
      const value = argument.slice('--limit='.length);
      if (!/^[1-9]\d*$/.test(value)) {
        throw new Error('--limit must be a positive integer.');
      }
      options.limit = Number(value);
    } else if (argument === '--slug') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--slug requires a non-empty slug.');
      }
      options.slug = value.trim();
      index += 1;
    } else if (argument.startsWith('--slug=')) {
      const value = argument.slice('--slug='.length).trim();
      if (!value) throw new Error('--slug requires a non-empty slug.');
      options.slug = value;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  return options;
}

async function ensurePostDirectories(dryRun) {
  if (dryRun) return;
  await Promise.all(
    [POST_PATHS.content, POST_PATHS.media, POST_PATHS.raw, POST_PATHS.reports].map(
      (directory) => fs.mkdir(directory, { recursive: true }),
    ),
  );
}

async function loadExistingPosts(state) {
  const entries = [];
  let files = [];
  try {
    files = await fs.readdir(POST_PATHS.content, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return entries;
    throw error;
  }
  for (const file of files) {
    if (!file.isFile() || path.extname(file.name).toLowerCase() !== '.md') continue;
    const filePath = path.join(POST_PATHS.content, file.name);
    try {
      const source = await fs.readFile(filePath, 'utf8');
      const parsed = splitFrontmatter(source);
      entries.push({ filePath, fileName: file.name, source, ...parsed });
    } catch (error) {
      state.warnings.push({
        type: 'invalid_existing_post_frontmatter',
        file: relativeProjectPath(filePath),
        message: String(error?.message || 'Existing post frontmatter is invalid.'),
      });
    }
  }
  return entries;
}

function duplicateGroups(posts, selector) {
  const groups = new Map();
  for (const post of posts) {
    const value = selector(post);
    if (!value) continue;
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(post);
  }
  return [...groups.entries()].filter(([, items]) => items.length > 1);
}

function recordInputConflicts(posts, state) {
  for (const [slug, items] of duplicateGroups(
    posts,
    (post) => String(post?.slug ?? ''),
  )) {
    state.duplicateSlugs.push({
      slug,
      posts: items.map((post) => ({
        wordpress_id: post.id,
        title: decodeHtmlText(post?.title?.rendered),
      })),
    });
  }
  const parsed = posts.map((post) => ({
    post,
    permalink: parsePostPermalink(post?.link),
  }));
  for (const [legacyUrl, items] of duplicateGroups(
    parsed,
    (item) => item.permalink.legacyUrl,
  )) {
    state.duplicateUrls.push({
      legacy_url: legacyUrl,
      posts: items.map(({ post }) => ({
        wordpress_id: post.id,
        title: decodeHtmlText(post?.title?.rendered),
        slug: String(post?.slug ?? ''),
      })),
    });
  }
  for (const { post, permalink } of parsed) {
    if (!permalink.legacyUrl) continue;
    const exact = RESERVED_EXACT_PATHS.has(permalink.legacyUrl);
    const prefix = RESERVED_PREFIXES.find((value) =>
      permalink.legacyUrl.startsWith(value),
    );
    if (!exact && !prefix) continue;
    state.routeConflicts.push({
      wordpress_id: post.id,
      slug: String(post?.slug ?? ''),
      legacy_url: permalink.legacyUrl,
      conflict: exact ? 'static_page' : `reserved_prefix:${prefix}`,
    });
  }
}

function warning(state, post, type, message, extra = {}) {
  state.warnings.push({
    type,
    wordpress_id: post?.id ?? null,
    slug: String(post?.slug ?? ''),
    message,
    ...extra,
  });
}

function embeddedAuthor(post) {
  const author = post?._embedded?.author?.[0];
  return author
    ? { id: Number(post?.author) || Number(author.id) || null, name: decodeHtmlText(author.name) }
    : null;
}

async function resolveAuthor(client, post) {
  const embedded = embeddedAuthor(post);
  if (embedded?.name) return embedded;
  const fetched = await client.fetchUser(post?.author);
  return {
    id: Number(post?.author) || Number(fetched?.id) || null,
    name: decodeHtmlText(fetched?.name),
  };
}

function embeddedTerms(post, taxonomy) {
  const terms = Array.isArray(post?._embedded?.['wp:term'])
    ? post._embedded['wp:term'].flat()
    : [];
  return terms.filter((term) => term?.taxonomy === taxonomy);
}

function uniqueNames(terms) {
  return [
    ...new Set(
      (Array.isArray(terms) ? terms : [])
        .map((term) => decodeHtmlText(term?.name))
        .filter(Boolean),
    ),
  ];
}

async function resolveTerms(client, post, taxonomy, endpoint, ids) {
  const embedded = embeddedTerms(post, taxonomy);
  if (embedded.length || !ids?.length) return uniqueNames(embedded);
  return uniqueNames(await client.fetchTerms(endpoint, ids));
}

function featuredMediaFromEmbed(post) {
  const media = post?._embedded?.['wp:featuredmedia']?.[0];
  return media && typeof media === 'object' ? media : null;
}

function mediaCaption(media) {
  return decodeHtmlText(media?.caption?.rendered);
}

async function enrichContentImages(client, images) {
  const ids = images.map((image) => image.media_id).filter(Boolean);
  const media = await client.fetchMediaBatch(ids);
  const mediaById = new Map(media.filter(Boolean).map((item) => [Number(item.id), item]));
  return images.map((image) => {
    const item = mediaById.get(Number(image.media_id));
    return {
      ...image,
      alt: decodeHtmlText(item?.alt_text) || image.alt,
      caption: mediaCaption(item) || image.caption,
    };
  });
}

async function resolveCoverMedia(client, post, contentImages) {
  const embedded = featuredMediaFromEmbed(post);
  const fetched =
    embedded || (post?.featured_media ? await client.fetchMedia(post.featured_media) : null);
  const sourceUrl = String(fetched?.source_url ?? '').trim();
  if (sourceUrl) {
    return {
      url: sourceUrl,
      alt: decodeHtmlText(fetched?.alt_text),
      caption: mediaCaption(fetched),
    };
  }
  return contentImages[0] || null;
}

function shortcodeReportItems(post, shortcodes) {
  const seen = new Set();
  const items = [];
  for (const shortcode of shortcodes) {
    const key = `${shortcode.name}:${shortcode.original}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      wordpress_id: post?.id ?? null,
      slug: String(post?.slug ?? ''),
      shortcode: shortcode.name,
      original: shortcode.original,
    });
  }
  return items;
}

function addImageReplacement(replacements, remoteUrl, localPath) {
  if (!remoteUrl || !localPath) return;
  const raw = String(remoteUrl);
  const canonical = postImageUrlKey(raw);
  replacements.set(raw, localPath);
  replacements.set(canonical, localPath);
  try {
    replacements.set(decodeURI(canonical), localPath);
  } catch {
    // The raw and canonical forms remain available.
  }
}

async function processPost(context, post, index) {
  const {
    client,
    duplicateSlugs,
    existingById,
    existingBySlug,
    options,
    state,
    total,
    urlMap,
  } = context;
  const title =
    decodeHtmlText(post?.title?.rendered) || `Post #${post?.id ?? 'unknown'}`;
  console.log(`[${index + 1}/${total}] ${title}`);
  state.summary.posts_processed += 1;

  const existing =
    existingById.get(String(post?.id)) ||
    (existingBySlug.get(String(post?.slug ?? ''))?.data?.wordpress_id == null
      ? existingBySlug.get(String(post?.slug ?? ''))
      : null);
  const baseStem = safePostFileStem(post?.slug, post?.id);
  const outputStem =
    !post?.slug || duplicateSlugs.has(String(post.slug))
      ? `${baseStem}-${post.id}`
      : baseStem;
  const outputPath = path.join(POST_PATHS.content, `${outputStem}.md`);
  const mediaDirectory = path.join(POST_PATHS.media, outputStem);
  const permalink = parsePostPermalink(post?.link);

  if (permalink.error) {
    warning(state, post, 'invalid_permalink', permalink.error, {
      source_url: permalink.sourceUrl,
    });
  }
  if (!post?.slug) {
    warning(
      state,
      post,
      'missing_slug',
      `Fallback file stem "${outputStem}" was used.`,
    );
  }

  if (existing && path.resolve(existing.filePath) !== path.resolve(outputPath)) {
    const slugChange = {
      wordpress_id: post.id,
      old_slug: String(existing.data?.slug ?? ''),
      new_slug: String(post?.slug ?? ''),
      old_file: relativeProjectPath(existing.filePath),
      new_file: relativeProjectPath(outputPath),
      old_url: String(existing.data?.legacy_url ?? existing.data?.permalink ?? ''),
      new_url: permalink.legacyUrl,
      redirect_required:
        String(existing.data?.legacy_url ?? existing.data?.permalink ?? '') !==
        permalink.legacyUrl,
    };
    state.slugChanges.push(slugChange);
    if (slugChange.redirect_required) {
      warning(state, post, 'post_redirect_required', 'The legacy post URL changed.', {
        old_url: slugChange.old_url,
        new_url: slugChange.new_url,
      });
    }
  }

  const prepared = preparePostContent(post?.content?.rendered);
  if (prepared.removedBlocks.length) {
    state.cleanedBlocks.push({
      wordpress_id: post.id,
      slug: String(post?.slug ?? ''),
      removed_blocks: prepared.removedBlocks,
    });
  }
  const enrichedImages = await enrichContentImages(client, prepared.images);
  const coverMedia = await resolveCoverMedia(client, post, enrichedImages);
  const author = await resolveAuthor(client, post);
  const categories = await resolveTerms(
    client,
    post,
    'category',
    'categories',
    post?.categories,
  );
  const tags = await resolveTerms(client, post, 'post_tag', 'tags', post?.tags);

  if (!author.name) {
    warning(state, post, 'missing_author', 'Post author name could not be resolved.');
  }
  if (coverMedia?.url) state.summary.featured_images_found += 1;
  else warning(state, post, 'missing_cover', 'Post does not have a featured or content image.');
  state.summary.content_images_found += enrichedImages.length;

  const replacements = new Map();
  let cover = String(existing?.data?.cover ?? '');
  const coverKey = coverMedia?.url ? postImageUrlKey(coverMedia.url) : '';
  if (coverMedia?.url) {
    const coverResult = await materializePostImage({
      url: coverMedia.url,
      directory: mediaDirectory,
      baseName: 'cover',
      force: options.force,
      dryRun: options.dryRun,
      stats: state.summary,
      failures: state.failedImages,
      post,
      kind: 'cover',
    });
    cover = coverResult.path || cover;
    if (coverResult.path) {
      addImageReplacement(replacements, coverMedia.url, coverResult.path);
    }
    if (options.dryRun) {
      console.log(`  - Would materialize cover: ${coverResult.path}`);
    }
  } else {
    cover = '';
  }

  let contentIndex = 0;
  for (const image of enrichedImages) {
    const key = postImageUrlKey(image.url);
    if (coverKey && key === coverKey && replacements.has(coverKey)) continue;
    contentIndex += 1;
    const result = await materializePostImage({
      url: image.url,
      directory: mediaDirectory,
      baseName: `image-${String(contentIndex).padStart(2, '0')}`,
      force: options.force,
      dryRun: options.dryRun,
      stats: state.summary,
      failures: state.failedImages,
      post,
      kind: 'content',
    });
    if (result.path) addImageReplacement(replacements, image.url, result.path);
    if (options.dryRun) {
      console.log(`  - Would materialize content image: ${result.path}`);
    }
  }

  const converted = postHtmlToMarkdown(
    prepared.html,
    replacements,
    enrichedImages,
    prepared.reviewShortcodes,
  );
  const excerpt = buildPostExcerpt(post?.excerpt?.rendered, prepared.html);
  const allShortcodes = shortcodeReportItems(post, [
    ...prepared.shortcodes,
    ...converted.shortcodes,
  ]);
  state.shortcodes.push(...allShortcodes);
  if (!converted.markdown.trim()) {
    state.emptyContent.push({
      wordpress_id: post.id,
      slug: String(post?.slug ?? ''),
      title,
    });
    warning(state, post, 'empty_post_content', 'Converted post content is empty.');
  }

  if (prepared.videos.length) {
    state.summary.posts_with_youtube_videos += 1;
    state.summary.youtube_videos_found += prepared.videos.length;
  }

  const frontmatter = buildPostFrontmatter(
    post,
    {
      sourceUrl: permalink.sourceUrl,
      legacyUrl: permalink.legacyUrl,
      excerpt,
      cover,
      author,
      categories,
      tags,
      videos: prepared.videos,
    },
    existing?.data,
  );
  const rendered = renderMarkdown(frontmatter, converted.markdown);

  urlMap.push({
    wordpress_id: post.id,
    slug: String(post?.slug ?? ''),
    source_url: permalink.sourceUrl,
    legacy_url: permalink.legacyUrl,
    new_url: permalink.legacyUrl,
  });

  console.log(`  ✓ Permalink preserved: ${permalink.legacyUrl || '(invalid)'}`);
  if (prepared.removedBlocks.length) {
    console.log(`  ✓ ${prepared.removedBlocks.length} recommendation block(s) removed`);
  }
  if (prepared.videos.length) {
    console.log(`  ✓ ${prepared.videos.length} YouTube video(s) found`);
  }
  if (options.dryRun) {
    console.log(
      `  ✓ Would ${existing ? 'update' : 'create'} ${relativeProjectPath(outputPath)}`,
    );
    return;
  }

  if (!options.force && existing?.source === rendered && path.resolve(existing.filePath) === path.resolve(outputPath)) {
    state.summary.posts_skipped += 1;
    console.log('  - Markdown unchanged');
    return;
  }

  await writeTextAtomic(outputPath, rendered);
  if (existing && path.resolve(existing.filePath) !== path.resolve(outputPath)) {
    const resolvedOld = path.resolve(existing.filePath);
    const contentRoot = `${path.resolve(POST_PATHS.content)}${path.sep}`;
    if (!resolvedOld.startsWith(contentRoot)) {
      throw new Error('Refusing to remove a post file outside content/posts.');
    }
    await fs.unlink(resolvedOld);
  }
  if (existing) {
    state.summary.posts_updated += 1;
    console.log('  ✓ Markdown updated');
  } else {
    state.summary.posts_created += 1;
    console.log('  ✓ Markdown created');
  }
}

async function main() {
  assertNodeVersion();
  const options = parsePostCliArgs(process.argv.slice(2));
  await ensurePostDirectories(options.dryRun);
  const environment = validateWordPressEnvironment(process.env);
  const client = new WordPressClient(environment);
  const state = createPostReportState(options);

  let fetched;
  try {
    fetched = await client.fetchPosts({
      limit: options.limit,
      slug: options.slug,
    });
  } catch (error) {
    const safe = sanitizeError(error);
    console.error(safe.message.replace('WooCommerce', 'WordPress'));
    process.exitCode =
      error instanceof WordPressApiError &&
      (error.status === 401 || error.status === 403)
        ? 3
        : 2;
    return;
  }

  console.log('WordPress connection successful');
  console.log(
    `Found ${fetched.total} published post${fetched.total === 1 ? '' : 's'}${options.limit ? `; processing first ${fetched.items.length}` : ''}`,
  );
  state.summary.posts_found = fetched.total;
  if (options.slug && fetched.items.length === 0) {
    console.error(`Published WordPress post not found for slug: ${options.slug}`);
    process.exitCode = 1;
    return;
  }

  const existingPosts = await loadExistingPosts(state);
  const existingById = new Map(
    existingPosts
      .filter((entry) => entry.data?.wordpress_id != null)
      .map((entry) => [String(entry.data.wordpress_id), entry]),
  );
  const existingBySlug = new Map(
    existingPosts
      .filter((entry) => typeof entry.data?.slug === 'string')
      .map((entry) => [entry.data.slug, entry]),
  );
  recordInputConflicts(fetched.items, state);
  const duplicateSlugs = new Set(
    state.duplicateSlugs.map((item) => item.slug),
  );
  const urlMap = [];
  const context = {
    client,
    duplicateSlugs,
    existingById,
    existingBySlug,
    options,
    state,
    total: fetched.items.length,
    urlMap,
  };

  for (let index = 0; index < fetched.items.length; index += 1) {
    const post = fetched.items[index];
    try {
      await processPost(context, post, index);
    } catch (error) {
      state.failedPosts.push({
        wordpress_id: post?.id ?? null,
        title: decodeHtmlText(post?.title?.rendered),
        slug: String(post?.slug ?? ''),
        error: sanitizeError(error).message.replace('WooCommerce', 'WordPress'),
      });
      console.log(`  ✗ Post failed: ${sanitizeError(error).message}`);
    }
  }

  if (options.limit === null && options.slug === null) {
    const fetchedIds = new Set(
      fetched.items.map((post) => String(post.id)),
    );
    state.missingPosts = existingPosts
      .filter(
        (entry) =>
          entry.data?.wordpress_id != null &&
          !fetchedIds.has(String(entry.data.wordpress_id)),
      )
      .map((entry) => ({
        wordpress_id: entry.data.wordpress_id,
        slug: String(entry.data.slug ?? ''),
        file: relativeProjectPath(entry.filePath),
      }));
  }

  finalizePostReport(state);
  if (!options.dryRun) {
    await writeJsonAtomic(
      path.join(POST_PATHS.raw, 'posts.json'),
      fetched.items,
    );
    await writeJsonAtomic(
      path.join(POST_PATHS.raw, 'post-import-metadata.json'),
      {
        source_site: environment.siteUrl,
        api_version: 'wp/v2',
        imported_at: state.summary.completed_at,
        post_count: fetched.items.length,
        dry_run: false,
        limit: options.limit,
        slug: options.slug,
      },
    );
    await writeJsonAtomic(POST_PATHS.urlMap, urlMap);
    await writePostReports(state, POST_PATHS.reports);
  }

  console.log('\nPost import completed\n');
  console.log(`Posts created: ${state.summary.posts_created}`);
  console.log(`Posts updated: ${state.summary.posts_updated}`);
  console.log(`Posts skipped: ${state.summary.posts_skipped}`);
  console.log(`Posts failed: ${state.summary.posts_failed}`);
  console.log(`Covers downloaded: ${state.summary.covers_downloaded}`);
  console.log(
    `Content images downloaded: ${state.summary.content_images_downloaded}`,
  );
  console.log(`Cleaned blocks: ${state.summary.cleaned_blocks}`);
  console.log(`YouTube videos found: ${state.summary.youtube_videos_found}`);
  if (options.dryRun) {
    console.log('\nDry run completed; no files, images, raw data, or reports were written.');
  } else {
    console.log('\nReport:\nmigration/reports/post-import-report.json');
  }

  if (state.failedPosts.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(sanitizeError(error).message.replace('WooCommerce', 'WordPress'));
  process.exitCode = 2;
});
