import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const products = defineCollection({
  loader: glob({
    pattern: '**/*.md',
    base: './content/products',
  }),
  schema: z
    .object({
      title: z.string().min(1),
      slug: z.string().min(1),
      wordpress_id: z.number().int().optional(),
      woocommerce_type: z.string().default(''),
      status: z.string(),
      source_url: z.string().default(''),
      legacy_url: z.string().default(''),
      permalink: z.string().min(1),
      price: z.string().default(''),
      regular_price: z.string().default(''),
      sale_price: z.string().default(''),
      currency: z.string().default(''),
      pricing_source: z.string().default(''),
      standard_license_variation_id: z.number().int().nullable().optional(),
      standard_license_label: z.string().default(''),
      excerpt: z.string().default(''),
      cover: z.string().default(''),
      gallery: z.array(z.string()).default([]),
      videos: z
        .array(
          z.object({
            provider: z.literal('youtube'),
            id: z.string().min(1),
            url: z.string().url(),
            embed_url: z.string().url(),
          }),
        )
        .default([]),
      categories: z.array(z.string()).default([]),
      tags: z.array(z.string()).default([]),
      gumroad_url: z.string().default(''),
      published_at: z.string().default(''),
      updated_at: z.string().default(''),
      menu_order: z.number().default(0),
    })
    .passthrough(),
});

const posts = defineCollection({
  loader: glob({
    pattern: '**/*.md',
    base: './content/posts',
  }),
  schema: z
    .object({
      title: z.string().min(1),
      slug: z.string().min(1),
      wordpress_id: z.number().int().optional(),
      status: z.string().default(''),
      source_url: z.string().default(''),
      legacy_url: z.string().default(''),
      permalink: z.string().min(1),
      excerpt: z.string().default(''),
      cover: z.string().default(''),
      author: z
        .object({
          id: z.number().int().optional(),
          name: z.string().default(''),
        })
        .passthrough()
        .optional(),
      categories: z.array(z.string()).default([]),
      tags: z.array(z.string()).default([]),
      videos: z
        .array(
          z
            .object({
              provider: z.string().default(''),
              id: z.string().default(''),
              url: z.string().default(''),
            })
            .passthrough(),
        )
        .default([]),
      published_at: z.string().default(''),
      updated_at: z.string().default(''),
    })
    .passthrough(),
});

export const collections = { products, posts };
