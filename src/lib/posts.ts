import { getCollection, type CollectionEntry } from 'astro:content';
import { dateTimestamp } from './formatDate';
import { validatePostPermalinks } from './post-urls.mjs';

export type PostEntry = CollectionEntry<'posts'>;

function meaningfulDate(post: PostEntry): number | null {
  return dateTimestamp(post.data.published_at) ?? dateTimestamp(post.data.updated_at);
}

export function sortPosts(posts: PostEntry[]): PostEntry[] {
  return [...posts].sort((left, right) => {
    const leftDate = meaningfulDate(left);
    const rightDate = meaningfulDate(right);
    if (leftDate !== null || rightDate !== null) {
      if (leftDate === null) return 1;
      if (rightDate === null) return -1;
      if (leftDate !== rightDate) return rightDate - leftDate;
    }
    return left.data.title.localeCompare(right.data.title, 'en');
  });
}

export async function getPublishedPosts(): Promise<PostEntry[]> {
  const posts = await getCollection('posts', ({ data }) => data.status === 'published');
  validatePostPermalinks(posts);
  return sortPosts(posts);
}

function cleanText(value: string): string {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[#>*_`~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(value: string, maximumLength: number): string {
  if (value.length <= maximumLength) return value;
  const shortened = value.slice(0, maximumLength - 1).replace(/\s+\S*$/, '').trimEnd();
  return `${shortened || value.slice(0, maximumLength - 1).trimEnd()}…`;
}

export function postExcerpt(post: PostEntry, maximumLength = 220): string {
  const imported = cleanText(post.data.excerpt);
  if (imported) return truncate(imported, maximumLength);
  return truncate(cleanText(post.body || ''), maximumLength);
}

export function postMetaDescription(post: PostEntry): string {
  return postExcerpt(post, 160) || post.data.title;
}

export function postReadingMinutes(post: PostEntry, wordsPerMinute = 210): number {
  const words = cleanText(post.body || '').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / wordsPerMinute));
}
