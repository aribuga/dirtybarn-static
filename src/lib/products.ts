import { getCollection, type CollectionEntry } from 'astro:content';
import { validateProductPermalinks } from './urls.mjs';

export type ProductEntry = CollectionEntry<'products'>;

function timestamp(value: string): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function sortProducts(products: ProductEntry[]): ProductEntry[] {
  return [...products].sort((left, right) => {
    const leftDate = timestamp(left.data.published_at);
    const rightDate = timestamp(right.data.published_at);
    if (leftDate !== null || rightDate !== null) {
      if (leftDate === null) return 1;
      if (rightDate === null) return -1;
      if (leftDate !== rightDate) return rightDate - leftDate;
    }

    const orderDifference = left.data.menu_order - right.data.menu_order;
    if (orderDifference !== 0) return orderDifference;
    return left.data.title.localeCompare(right.data.title, 'en');
  });
}

export async function getPublishedProducts(): Promise<ProductEntry[]> {
  const products = await getCollection('products', ({ data }) => data.status === 'published');
  validateProductPermalinks(products);
  return sortProducts(products);
}

export function productDescription(product: ProductEntry): string {
  return product.data.excerpt.trim() || product.body?.trim() || '';
}

export function metaDescription(value: string, maximumLength = 160): string {
  const normalized = value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maximumLength) return normalized;
  return `${normalized.slice(0, maximumLength - 1).trimEnd()}…`;
}

export function productImages(product: ProductEntry): string[] {
  return [...new Set([product.data.cover, ...product.data.gallery].filter(Boolean))];
}

export function categoryFilterKey(value: string): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function isFreeProduct(product: ProductEntry): boolean {
  const price = Number(product.data.price);
  return Number.isFinite(price) && price === 0;
}

export function relatedProducts(
  current: ProductEntry,
  products: ProductEntry[],
  limit = 3,
): ProductEntry[] {
  const categories = new Set(current.data.categories.map((value) => value.toLowerCase()));
  const tags = new Set(current.data.tags.map((value) => value.toLowerCase()));

  return products
    .filter((product) => product.id !== current.id)
    .map((product, index) => {
      const categoryMatches = product.data.categories.filter((value) =>
        categories.has(value.toLowerCase()),
      ).length;
      const tagMatches = product.data.tags.filter((value) => tags.has(value.toLowerCase())).length;
      return { product, score: categoryMatches * 100 + tagMatches * 10 - index / 1000 };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ product }) => product);
}
