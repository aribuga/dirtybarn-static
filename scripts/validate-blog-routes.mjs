#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import {
  RESERVED_BLOG_ROUTES,
  validatePostPermalinks,
} from '../src/lib/post-urls.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const postsDirectory = path.join(projectRoot, 'content/posts');
const productsDirectory = path.join(projectRoot, 'content/products');
const pagesDirectory = path.join(projectRoot, 'src/pages');
const publicDirectory = path.join(projectRoot, 'public');

function parseMarkdown(source, file) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error(`Invalid Markdown frontmatter delimiters: ${file}`);
  return { data: yaml.load(match[1]) || {}, body: match[2] || '' };
}

async function readMarkdownDirectory(directory) {
  const files = (await fs.readdir(directory)).filter((file) => file.endsWith('.md')).sort();
  return Promise.all(
    files.map(async (file) => {
      const source = await fs.readFile(path.join(directory, file), 'utf8');
      const parsed = parseMarkdown(source, file);
      return { id: file, source, ...parsed };
    }),
  );
}

async function collectStaticRoutes(directory, relative = '') {
  const routes = new Map();
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const nextRelative = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.includes('[')) {
        for (const [route, source] of await collectStaticRoutes(
          path.join(directory, entry.name),
          nextRelative,
        )) {
          routes.set(route, source);
        }
      }
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.astro') || nextRelative.includes('[')) continue;
    const withoutExtension = nextRelative.replace(/\.astro$/, '');
    let route;
    if (withoutExtension === 'index') route = '/';
    else if (withoutExtension === '404') route = '/404.html';
    else if (withoutExtension.endsWith('/index')) route = `/${withoutExtension.slice(0, -6)}/`;
    else route = `/${withoutExtension}/`;
    routes.set(route, `src/pages/${nextRelative}`);
  }
  return routes;
}

function mediaReferences(body) {
  return [...String(body || '').matchAll(/\/media\/posts\/[^\s)\]"'<>?#]+/g)].map(
    (match) => match[0],
  );
}

function publicFilePath(urlPath) {
  let decoded = urlPath;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const relative = decoded.replace(/^\/+/, '').replaceAll('/', path.sep);
  const resolved = path.resolve(publicDirectory, relative);
  return resolved.startsWith(`${publicDirectory}${path.sep}`) ? resolved : null;
}

const allPosts = await readMarkdownDirectory(postsDirectory);
const publishedPosts = allPosts.filter(({ data }) => data.status === 'published');
const allProducts = await readMarkdownDirectory(productsDirectory);
const publishedProducts = allProducts.filter(({ data }) => data.status === 'published');
const staticRoutes = new Map([...RESERVED_BLOG_ROUTES, ...(await collectStaticRoutes(pagesDirectory))]);

for (const product of publishedProducts) {
  const permalink = String(product.data.permalink || '').trim();
  if (permalink) staticRoutes.set(permalink, `product: ${product.data.title || product.id}`);
}

const warnings = [];
const routes = validatePostPermalinks(publishedPosts, {
  existingRoutes: staticRoutes,
  warn: (message) => warnings.push(message),
});

const missingCovers = [];
const missingContentMedia = [];
const emptyBodies = [];
const invalidDates = [];

for (const post of publishedPosts) {
  if (!String(post.body || '').trim()) emptyBodies.push(post);
  for (const field of ['published_at', 'updated_at']) {
    const value = String(post.data[field] || '').trim();
    if (value && !Number.isFinite(Date.parse(value))) invalidDates.push({ post, field, value });
  }

  const cover = String(post.data.cover || '').trim();
  if (cover) {
    const filePath = publicFilePath(cover);
    if (!filePath || !(await fs.stat(filePath).catch(() => null))?.isFile()) {
      missingCovers.push({ post, url: cover });
    }
  }

  for (const url of new Set(mediaReferences(post.body))) {
    const filePath = publicFilePath(url);
    if (!filePath || !(await fs.stat(filePath).catch(() => null))?.isFile()) {
      missingContentMedia.push({ post, url });
    }
  }
}

for (const warning of warnings) console.warn(`Warning: ${warning}`);
for (const { post, url } of missingCovers) {
  console.warn(`Missing blog cover: ${post.data.title || post.id} — ${url}`);
}
for (const { post, url } of missingContentMedia) {
  console.warn(`Missing blog media: ${post.data.title || post.id} — ${url}`);
}
for (const post of emptyBodies) {
  console.warn(`Empty blog Markdown body: ${post.data.title || post.id}`);
}
for (const { post, field, value } of invalidDates) {
  console.warn(`Invalid blog date: ${post.data.title || post.id} — ${field}: ${value}`);
}

console.log(`Published blog posts: ${publishedPosts.length}`);
console.log(`Validated blog routes: ${routes.length}`);
console.log(`Duplicate permalinks: 0`);
console.log(`Reserved route conflicts: 0`);
console.log(`Missing permalinks: 0`);
console.log(`Missing covers: ${missingCovers.length}`);
console.log(`Missing content media: ${missingContentMedia.length}`);
console.log(`Empty Markdown bodies: ${emptyBodies.length}`);
console.log(`Invalid dates: ${invalidDates.length}`);
console.log('Blog route validation passed.');
