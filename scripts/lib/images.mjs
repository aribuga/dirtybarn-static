import fs from 'node:fs/promises';
import path from 'node:path';
import { delay, publicPathFor, redactSensitiveUrl } from './utils.mjs';

const EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'bmp', 'tif', 'tiff']);
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

export function extensionFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const extension = path.extname(pathname).slice(1).toLowerCase();
    return EXTENSIONS.has(extension) ? extension : '';
  } catch {
    return '';
  }
}

function canonicalImageUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return String(url ?? '');
  }
}

async function existingImage(directory, baseName) {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith(`${baseName}.`)) continue;
      const filePath = path.join(directory, entry.name);
      const stats = await fs.stat(filePath);
      if (stats.size > 0) return filePath;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return null;
}

async function fetchImage(url) {
  for (let attempt = 0; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'image/*', 'User-Agent': 'dirtybarn-woocommerce-migrator/1.0' },
        redirect: 'follow',
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) {
        const contentType = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
        if (!contentType.startsWith('image/')) {
          throw Object.assign(new Error('Response content type is not an image.'), {
            retryable: false,
          });
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length === 0) {
          throw Object.assign(new Error('Downloaded image is empty.'), { retryable: false });
        }
        const extension = extensionFromUrl(url) || CONTENT_TYPE_EXTENSIONS.get(contentType);
        if (!extension) {
          throw Object.assign(new Error(`Unsupported image content type: ${contentType || 'unknown'}.`), {
            retryable: false,
          });
        }
        return { bytes, extension, contentType };
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable) {
        throw Object.assign(new Error(`Image request failed with HTTP ${response.status}.`), {
          retryable: false,
        });
      }
      if (attempt === 3) throw new Error(`Image request failed with HTTP ${response.status}.`);
    } catch (error) {
      if (error?.retryable === false || attempt === 3) throw error;
    }
    await delay(300 * 2 ** attempt);
  }
  throw new Error('Image request failed.');
}

export async function materializeImage({
  url,
  directory,
  baseName,
  force,
  dryRun,
  stats,
  failedImages,
  product,
}) {
  stats.images_found += 1;
  const predictedExtension = extensionFromUrl(url);
  if (dryRun) {
    return {
      status: 'planned',
      path: `/media/products/${path.basename(directory)}/${baseName}.${predictedExtension || 'image'}`,
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
    const { bytes, extension } = await fetchImage(url);
    const destination = path.join(directory, `${baseName}.${extension}`);
    const temporaryPath = `${destination}.tmp-${process.pid}`;
    await fs.writeFile(temporaryPath, bytes);
    await fs.rename(temporaryPath, destination);
    const written = await fs.stat(destination);
    if (written.size === 0) throw new Error('Downloaded image is empty after writing.');
    stats.images_downloaded += 1;
    return { status: 'downloaded', path: publicPathFor(destination) };
  } catch (error) {
    stats.images_failed += 1;
    failedImages.push({
      wordpress_id: product?.id ?? null,
      slug: String(product?.slug ?? ''),
      image_url: redactSensitiveUrl(url),
      target: baseName,
      error: String(error?.message || 'Image download failed.'),
    });
    return { status: 'failed', path: '' };
  }
}

export function imageUrlKey(url) {
  return canonicalImageUrl(url);
}
