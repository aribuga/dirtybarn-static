import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import sanitizeHtml from 'sanitize-html';

let processorPromise;

function markdownProcessor() {
  processorPromise ||= createMarkdownProcessor({
    gfm: true,
    smartypants: false,
  });
  return processorPromise;
}

export async function renderSafeMarkdown(markdown, { preserveFigures = false } = {}) {
  const processor = await markdownProcessor();
  const rendered = await processor.render(String(markdown ?? ''));
  return sanitizeHtml(rendered.code, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      'img',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'table',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'th',
      'td',
      ...(preserveFigures ? ['figure', 'figcaption'] : []),
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
      th: ['colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
      code: ['class'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    transformTags: {
      a: (tagName, attributes) => {
        const external = /^https?:\/\//i.test(attributes.href || '');
        return {
          tagName,
          attribs: external
            ? { ...attributes, target: '_blank', rel: 'noopener noreferrer' }
            : attributes,
        };
      },
      img: (tagName, attributes) => ({
        tagName,
        attribs: { ...attributes, loading: 'lazy' },
      }),
    },
  });
}
