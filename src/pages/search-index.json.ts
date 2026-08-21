import type { APIRoute } from 'astro';
import { getPublishedProducts } from '../lib/products';
import { getPublishedPosts } from '../lib/posts';

export const prerender = true;

export const GET: APIRoute = async () => {
  const [products, posts] = await Promise.all([getPublishedProducts(), getPublishedPosts()]);
  const productItems = products.map((product) => ({
    title: product.data.title,
    type: 'Asset' as const,
    url: product.data.permalink,
    search: [product.data.title, ...product.data.categories, ...product.data.tags]
      .join(' ')
      .toLocaleLowerCase('en'),
  }));
  const postItems = posts.map((post) => ({
    title: post.data.title,
    type: 'Journal' as const,
    url: post.data.permalink,
    search: [post.data.title, post.data.excerpt, ...post.data.categories, ...post.data.tags]
      .join(' ')
      .toLocaleLowerCase('en'),
  }));
  const items = [];
  const length = Math.max(productItems.length, postItems.length);
  for (let index = 0; index < length; index += 1) {
    if (productItems[index]) items.push(productItems[index]);
    if (postItems[index]) items.push(postItems[index]);
  }

  return new Response(JSON.stringify(items), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
