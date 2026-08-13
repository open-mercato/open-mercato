import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const buildDir = new URL('../build/', import.meta.url);
const docsDir = fileURLToPath(new URL('../', import.meta.url));
const docsMetadataDir = new URL(
  '../.docusaurus/docusaurus-plugin-content-docs/default/',
  import.meta.url,
);

async function findHtmlFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = new URL(entry.name, dir);
      if (entry.isDirectory()) return findHtmlFiles(new URL(`${entry.name}/`, dir));
      return entry.name === 'index.html' ? [entryPath] : [];
    }),
  );

  return files.flat();
}

test('every generated documentation page includes a Copy page button', async () => {
  const htmlFiles = await findHtmlFiles(buildDir);
  const docsPages = (
    await Promise.all(
      htmlFiles.map(async (htmlFile) => ({
        htmlFile,
        content: await readFile(htmlFile, 'utf8'),
      })),
    )
  ).filter(({ content }) => content.includes('theme-doc-markdown'));
  const missingButtons = docsPages
    .filter(({ content }) => !content.includes('data-copy-page-button'))
    .map(({ htmlFile }) => path.relative(docsDir, fileURLToPath(htmlFile)));

  assert.ok(docsPages.length > 0, 'production build must contain documentation pages');
  assert.deepEqual(missingButtons, []);
});

test('every Copy page source URL resolves to its published raw MDX', async () => {
  const metadataFiles = (await readdir(docsMetadataDir)).filter((file) =>
    file.startsWith('site-docs-') && file.endsWith('.json'),
  );
  const missingRawFiles = await Promise.all(
    metadataFiles.map(async (metadataFile) => {
      const metadata = JSON.parse(await readFile(new URL(metadataFile, docsMetadataDir), 'utf8'));
      const sourcePath = metadata.source?.replace('@site/docs/', '');
      if (!sourcePath) return metadataFile;

      try {
        const [source, raw] = await Promise.all([
          readFile(new URL(`../docs/${sourcePath}`, import.meta.url), 'utf8'),
          readFile(new URL(`../build/raw/${sourcePath}`, import.meta.url), 'utf8'),
        ]);
        return source === raw ? null : sourcePath;
      } catch {
        return sourcePath;
      }
    }),
  );

  assert.deepEqual(missingRawFiles.filter(Boolean), []);
});
