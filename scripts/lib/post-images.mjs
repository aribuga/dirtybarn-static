import fs from 'node:fs/promises';
import path from 'node:path';
import { delay, publicPathFor, redactSensitiveUrl } from './utils.mjs';

const EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'avif',
  'svg',
  'bmp',
  'tif',
  'tiff',
]);
const CONTENT_TYPE_EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
  ['image/avif', 'avif'],
  ['image/svg+xml', 'svg'],
  ['image/bmp', 'bmp'],
  ['image/tiff', 'tiff'],
]);
const existingImageCache = new Map();

export function postImageUrlKey(value) {
  try {
    const url = new URL(String(value ?? ''));
    url.hash = '';
    return url.toString();
  } catch {
    return String(value ?? '');
  }
}

function extensionFromUrl(value) {
  try {
    const extension = path.extname(new URL(value).pathname).slice(1).toLowerCase();
    return EXTENSIONS.has(extension) ? extension : '';
  } catch {
    return '';
  }
}

async function existingImage(directory, baseName) {
  if (!existingImageCache.has(directory)) {
    const images = new Map();
    try {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const filePath = path.join(directory, entry.name);
        if ((await fs.stat(filePath)).size <= 0) continue;
        images.set(path.parse(entry.name).name, filePath);
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    existingImageCache.set(directory, images);
  }
  return existingImageCache.get(directory).get(baseName) || null;
}

async function downloadImage(url) {
  for (let attempt = 0; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'image/*',
          'User-Agent': 'dirtybarn-wordpress-post-migrator/1.0',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) {
        const contentType = (response.headers.get('content-type') || '')
          .split(';')[0]
          .toLowerCase();
        if (!contentType.startsWith('image/')) {
          throw Object.assign(
            new Error('Response content type is not an image.'),
            { retryable: false },
          );
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        if (!bytes.length) {
          throw Object.assign(new Error('Downloaded image is empty.'), {
            retryable: false,
          });
        }
        const extension =
          extensionFromUrl(url) || CONTENT_TYPE_EXTENSIONS.get(contentType);
        if (!extension) {
          throw Object.assign(
            new Error(`Unsupported image content type: ${contentType || 'unknown'}.`),
            { retryable: false },
          );
        }
        return { bytes, extension };
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === 3) {
        throw Object.assign(
          new Error(`Image request failed with HTTP ${response.status}.`),
          { retryable: false },
        );
      }
    } catch (error) {
      if (error?.retryable === false || attempt === 3) throw error;
    }
    await delay(300 * 2 ** attempt);
  }
  throw new Error('Image request failed.');
}

export async function materializePostImage({
  url,
  directory,
  baseName,
  force,
  dryRun,
  stats,
  failures,
  post,
  kind,
}) {
  const predictedExtension = extensionFromUrl(url);
  if (dryRun) {
    return {
      status: 'planned',
      path: `/media/posts/${path.basename(directory)}/${baseName}.${predictedExtension || 'image'}`,
    };
  }

  await fs.mkdir(directory, { recursive: true });
  if (!force) {
    const existing = await existingImage(directory, baseName);
    if (existing) {
      stats.images_skipped += 1;
      return { status: 'skipped', path: publicPathFor(existing) };
    }
  }

  try {
    const { bytes, extension } = await downloadImage(url);
    const destination = path.join(directory, `${baseName}.${extension}`);
    const temporary = `${destination}.tmp-${process.pid}`;
    await fs.writeFile(temporary, bytes);
    await fs.rename(temporary, destination);
    if ((await fs.stat(destination)).size <= 0) {
      throw new Error('Downloaded image is empty after writing.');
    }
    stats.images_downloaded += 1;
    if (!existingImageCache.has(directory)) {
      existingImageCache.set(directory, new Map());
    }
    existingImageCache.get(directory).set(baseName, destination);
    if (kind === 'cover') stats.covers_downloaded += 1;
    else stats.content_images_downloaded += 1;
    return { status: 'downloaded', path: publicPathFor(destination) };
  } catch (error) {
    stats.images_failed += 1;
    failures.push({
      wordpress_id: post?.id ?? null,
      slug: String(post?.slug ?? ''),
      image_url: redactSensitiveUrl(url),
      target: baseName,
      kind,
      error: String(error?.message || 'Image download failed.'),
    });
    return { status: 'failed', path: '' };
  }
}
