import type { Plugin } from 'unified';

/**
 * Remark plugin that injects the raw MDX source (Base64-encoded) into
 * frontMatter so it can be accessed at runtime via useDoc().frontMatter.raw_source.
 * Base64 encoding avoids JS parse errors from special characters in MDX content.
 */
const remarkRawSource: Plugin = () => {
  return (_tree, file) => {
    const data = file.data as { frontMatter?: Record<string, unknown> };
    data.frontMatter ??= {};
    data.frontMatter.raw_source = Buffer.from(String(file.value)).toString('base64');
  };
};

export default remarkRawSource;
