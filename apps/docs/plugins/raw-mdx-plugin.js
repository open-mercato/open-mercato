const path = require('path');
const fs = require('fs/promises');
const { existsSync, readdirSync, readFileSync, copyFileSync, mkdirSync } = require('fs');

const DOCS_SOURCE_PREFIX = '@site/docs/';

function isDocumentationSource(filePath) {
  return filePath.endsWith('.md') || filePath.endsWith('.mdx');
}

function isPathWithin(parentPath, candidatePath) {
  const relativePath = path.relative(parentPath, candidatePath);
  return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function getPublishedSourcePaths(generatedFilesDir) {
  const metadataDir = path.join(generatedFilesDir, 'docusaurus-plugin-content-docs', 'default');
  if (!existsSync(metadataDir)) return [];

  return readdirSync(metadataDir)
    .filter((fileName) => fileName.startsWith('site-docs-') && fileName.endsWith('.json'))
    .map((fileName) => JSON.parse(readFileSync(path.join(metadataDir, fileName), 'utf8')))
    .filter((metadata) => !metadata.draft && !metadata.unlisted)
    .map((metadata) => metadata.source)
    .filter((sourcePath) => sourcePath?.startsWith(DOCS_SOURCE_PREFIX))
    .map((sourcePath) => sourcePath.slice(DOCS_SOURCE_PREFIX.length));
}

/**
 * Docusaurus plugin that serves raw .mdx/.md source files at /raw/<path>
 * so the "Copy page" button can fetch and copy the original Markdown source.
 *
 * - Development: serves files via webpack devServer middleware
 * - Production: copies docs/ into build/raw/ during postBuild
 */
module.exports = function rawMdxPlugin(context) {
  const docsDir = path.resolve(context.siteDir, 'docs');

  return {
    name: 'raw-mdx-plugin',

    configureWebpack() {
      return {
        devServer: {
          setupMiddlewares(middlewares) {
            middlewares.unshift({
              name: 'raw-mdx',
              path: '/raw/*',
              async middleware(req, res) {
                const filePath = path.resolve(docsDir, req.params[0] ?? '');

                if (!isPathWithin(docsDir, filePath) || !isDocumentationSource(filePath)) {
                  res.status(403).end();
                  return;
                }

                try {
                  const content = await fs.readFile(filePath, 'utf-8');
                  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                  res.send(content);
                } catch {
                  res.status(404).end();
                }
              },
            });
            return middlewares;
          },
        },
      };
    },

    async postBuild({ outDir }) {
      const rawDir = path.join(outDir, 'raw');
      const publishedSourcePaths = getPublishedSourcePaths(context.generatedFilesDir);

      if (publishedSourcePaths.length === 0) {
        throw new Error(
          'raw-mdx-plugin: no published documentation sources found; refusing to emit an empty build/raw/ directory.',
        );
      }

      for (const sourcePath of publishedSourcePaths) {
        const sourceFilePath = path.resolve(docsDir, sourcePath);
        if (!isPathWithin(docsDir, sourceFilePath) || !isDocumentationSource(sourceFilePath)) {
          continue;
        }

        const rawFilePath = path.join(rawDir, sourcePath);
        mkdirSync(path.dirname(rawFilePath), { recursive: true });
        copyFileSync(sourceFilePath, rawFilePath);
      }
    },
  };
};
