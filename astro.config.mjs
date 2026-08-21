import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://dirtybarn.com',
  output: 'static',
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
});
