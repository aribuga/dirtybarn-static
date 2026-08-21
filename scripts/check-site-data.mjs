import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { validateProductPermalinks } from '../src/lib/urls.mjs';

const productsDirectory = path.resolve('content/products');
const files = (await fs.readdir(productsDirectory)).filter((file) => file.endsWith('.md'));
const products = [];

for (const file of files) {
  const source = await fs.readFile(path.join(productsDirectory, file), 'utf8');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`Invalid Markdown frontmatter delimiters: ${file}`);
  const data = yaml.load(match[1]);
  if (data?.status === 'published') products.push({ id: file, data });
}

const warnings = [];
validateProductPermalinks(products, { warn: (message) => warnings.push(message) });
for (const warning of warnings) console.warn(`Warning: ${warning}`);
console.log(`Site data check passed (${products.length} published product routes).`);
