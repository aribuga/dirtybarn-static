import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

export const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

export const PATHS = {
  products: path.join(PROJECT_ROOT, 'content', 'products'),
  mediaProducts: path.join(PROJECT_ROOT, 'public', 'media', 'products'),
  raw: path.join(PROJECT_ROOT, 'migration', 'raw'),
  reports: path.join(PROJECT_ROOT, 'migration', 'reports'),
  urlMap: path.join(PROJECT_ROOT, 'migration', 'product-url-map.json'),
};

export const REQUIRED_DIRECTORIES = Object.values(PATHS).filter(
  (value) => value !== PATHS.urlMap,
);

export function parseCliArgs(argv) {
  const options = { dryRun: false, force: false, limit: null, repairContent: false };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') {
      options.dryRun = true;
    } else if (argument === '--force') {
      options.force = true;
    } else if (argument === '--repair-content') {
      options.repairContent = true;
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
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  return options;
}

export function validateEnvironment(environment = process.env) {
  const siteUrl = environment.WOOCOMMERCE_URL?.trim();
  const consumerKey = environment.WOOCOMMERCE_CONSUMER_KEY?.trim();
  const consumerSecret = environment.WOOCOMMERCE_CONSUMER_SECRET?.trim();
  const currency = environment.WOOCOMMERCE_CURRENCY?.trim().toUpperCase() || '';

  if (!siteUrl) throw new Error('WOOCOMMERCE_URL is required.');
  let parsedUrl;
  try {
    parsedUrl = new URL(siteUrl);
  } catch {
    throw new Error('WOOCOMMERCE_URL must be a valid absolute URL.');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('WOOCOMMERCE_URL must use HTTP or HTTPS.');
  }
  if (!consumerKey) throw new Error('WOOCOMMERCE_CONSUMER_KEY is required.');
  if (!consumerKey.startsWith('ck_')) {
    throw new Error('WOOCOMMERCE_CONSUMER_KEY must start with ck_.');
  }
  if (!consumerSecret) throw new Error('WOOCOMMERCE_CONSUMER_SECRET is required.');
  if (!consumerSecret.startsWith('cs_')) {
    throw new Error('WOOCOMMERCE_CONSUMER_SECRET must start with cs_.');
  }

  parsedUrl.search = '';
  parsedUrl.hash = '';
  parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, '');

  return {
    siteUrl: parsedUrl.toString().replace(/\/$/, ''),
    consumerKey,
    consumerSecret,
    currency,
  };
}

export async function ensureDirectories({ dryRun = false } = {}) {
  for (const directory of REQUIRED_DIRECTORIES) {
    if (!dryRun) await fs.mkdir(directory, { recursive: true });
    await fs.access(directory, dryRun ? fs.constants.R_OK : fs.constants.W_OK);
  }
}

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('tr-TR');
}

export function safeProductFileStem(slug, wordpressId) {
  const value = String(slug ?? '').normalize('NFKC').trim();
  if (
    value &&
    !value.includes('/') &&
    !value.includes('\\') &&
    value !== '.' &&
    value !== '..' &&
    /^[\p{L}\p{N}._-]+$/u.test(value)
  ) {
    return value;
  }
  return `product-${Number.isInteger(Number(wordpressId)) ? wordpressId : 'unknown'}`;
}

export function parsePermalink(permalink) {
  if (!permalink) {
    return { sourceUrl: '', legacyUrl: '', error: 'Product permalink is missing.' };
  }
  try {
    const url = new URL(permalink);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
    const sourceUrl = `${url.origin}${url.pathname}`;
    return { sourceUrl, legacyUrl: url.pathname, error: null };
  } catch {
    return { sourceUrl: String(permalink), legacyUrl: '', error: 'Product permalink is invalid.' };
  }
}

export function relativeProjectPath(filePath) {
  return path.relative(PROJECT_ROOT, filePath).split(path.sep).join('/');
}

export function publicPathFor(filePath) {
  return `/${path.relative(path.join(PROJECT_ROOT, 'public'), filePath).split(path.sep).join('/')}`;
}

export async function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, filePath);
}

export async function writeTextAtomic(filePath, value) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await fs.writeFile(temporaryPath, value, 'utf8');
  await fs.rename(temporaryPath, filePath);
}

export function splitFrontmatter(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error('Markdown file does not contain valid YAML frontmatter delimiters.');
  const data = yaml.load(match[1]);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Markdown frontmatter must be a YAML object.');
  }
  return { data, body: match[2] };
}

export function renderMarkdown(frontmatter, body) {
  const multilineExcerpt =
    typeof frontmatter?.excerpt === 'string' && frontmatter.excerpt.includes('\n')
      ? frontmatter.excerpt
      : null;
  const excerptToken = `CODEX_MULTILINE_EXCERPT_${process.pid}_${Date.now()}`;
  const prepared =
    multilineExcerpt === null ? frontmatter : { ...frontmatter, excerpt: excerptToken };
  let dumped = yaml.dump(prepared, {
    noRefs: true,
    noCompatMode: true,
    lineWidth: -1,
    quotingType: '"',
    forceQuotes: true,
    sortKeys: false,
  });
  if (multilineExcerpt !== null) {
    const literal = multilineExcerpt
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n');
    dumped = dumped.replace(
      `excerpt: "${excerptToken}"`,
      `excerpt: |-\n${literal}`,
    );
  }
  const normalizedBody = String(body ?? '').trim();
  return `---\n${dumped}---\n${normalizedBody ? `\n${normalizedBody}\n` : '\n'}`;
}

export function sanitizeError(error) {
  const status = Number(error?.status) || undefined;
  const safeMessage =
    status === 401 || status === 403
      ? 'WooCommerce authentication failed.'
      : String(error?.message || 'Unknown error')
          .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, 'Basic [redacted]')
          .replace(/(consumer_key|consumer_secret)=[^&\s]+/gi, '$1=[redacted]');
  return { message: safeMessage, ...(status ? { status } : {}) };
}

export function redactSensitiveUrl(value) {
  try {
    const url = new URL(String(value ?? ''));
    for (const key of ['consumer_key', 'consumer_secret', 'authorization', 'password']) {
      if (url.searchParams.has(key)) url.searchParams.set(key, '[redacted]');
    }
    return url.toString();
  } catch {
    return String(value ?? '')
      .replace(/(consumer_key|consumer_secret|authorization|password)=[^&\s]+/gi, '$1=[redacted]');
  }
}

export function redactConfiguredCredentials(value, credentials) {
  const secrets = credentials.filter((credential) => typeof credential === 'string' && credential);
  if (Array.isArray(value)) {
    return value.map((item) => redactConfiguredCredentials(item, secrets));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        redactConfiguredCredentials(item, secrets),
      ]),
    );
  }
  if (typeof value !== 'string') return value;
  return secrets.reduce((result, secret) => result.replaceAll(secret, '[redacted]'), value);
}

export function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
