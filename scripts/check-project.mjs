#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requiredFiles = [
  '.env.example',
  '.gitignore',
  '.pages.yml',
  'package.json',
  'README.md',
  'scripts/import-woocommerce-products.mjs',
  'scripts/import-wordpress-posts.mjs',
  'scripts/validate-blog-routes.mjs',
  'scripts/lib/api.mjs',
  'scripts/lib/images.mjs',
  'scripts/lib/markdown.mjs',
  'scripts/lib/products.mjs',
  'scripts/lib/reports.mjs',
  'scripts/lib/utils.mjs',
  'scripts/lib/wordpress-api.mjs',
  'scripts/lib/post-cleanup.mjs',
  'scripts/lib/post-markdown.mjs',
  'scripts/lib/post-images.mjs',
  'scripts/lib/post-reports.mjs',
  'src/lib/post-urls.mjs',
  'src/lib/post-content.mjs',
];
const requiredDirectories = [
  'content/products',
  'content/posts',
  'public/media/products',
  'public/media/posts',
  'migration/raw',
  'migration/reports',
];

for (const relativePath of [...requiredFiles, ...requiredDirectories]) {
  try {
    await fs.access(path.join(projectRoot, relativePath));
  } catch {
    throw new Error(`Required project path is missing: ${relativePath}`);
  }
}

const gitignore = await fs.readFile(path.join(projectRoot, '.gitignore'), 'utf8');
const ignoresEnvironment = gitignore
  .split(/\r?\n/)
  .map((line) => line.trim())
  .some((line) => line === '.env' || line === '/.env');
if (!ignoresEnvironment) throw new Error('.env must be listed in .gitignore.');

const pagesConfig = yaml.load(await fs.readFile(path.join(projectRoot, '.pages.yml'), 'utf8'));
if (!Array.isArray(pagesConfig?.media) || pagesConfig.media.length < 2) {
  throw new Error('.pages.yml must define product and journal media sources.');
}
const pagesCollections = new Map(
  (Array.isArray(pagesConfig?.content) ? pagesConfig.content : []).map((entry) => [entry?.name, entry]),
);
for (const collectionName of ['products', 'posts']) {
  const collection = pagesCollections.get(collectionName);
  if (collection?.type !== 'collection' || !Array.isArray(collection.fields)) {
    throw new Error(`.pages.yml must define the ${collectionName} collection and its fields.`);
  }
  const fieldNames = new Set(collection.fields.map((field) => field?.name));
  for (const requiredField of ['title', 'slug', 'status', 'permalink', 'body']) {
    if (!fieldNames.has(requiredField)) {
      throw new Error(`Pages CMS ${collectionName} collection is missing field: ${requiredField}`);
    }
  }
}

const scriptsDirectory = path.join(projectRoot, 'scripts');
const moduleFiles = [];
async function collectModules(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectModules(entryPath);
    else if (entry.isFile() && entry.name.endsWith('.mjs')) moduleFiles.push(entryPath);
  }
}
await collectModules(scriptsDirectory);

for (const filePath of moduleFiles) {
  const result = spawnSync(process.execPath, ['--check', filePath], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    throw new Error(`Syntax check failed: ${path.relative(projectRoot, filePath)}`);
  }
}

console.log(
  `Project check passed (${moduleFiles.length} JavaScript modules checked; Pages CMS configured).`,
);
