const path = require('path');
const fs = require('fs/promises');
const { existsSync, readdirSync, copyFileSync, mkdirSync } = require('fs');

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
                const filePath = path.join(docsDir, req.params[0]);

                if (!filePath.startsWith(docsDir)) {
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

      function copyMdxFiles(srcDir, destDir) {
        if (!existsSync(srcDir)) return;
        mkdirSync(destDir, { recursive: true });

        for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
          const srcPath = path.join(srcDir, entry.name);
          const destPath = path.join(destDir, entry.name);

          if (entry.isDirectory()) {
            copyMdxFiles(srcPath, destPath);
          } else if (entry.name.endsWith('.mdx') || entry.name.endsWith('.md')) {
            copyFileSync(srcPath, destPath);
          }
        }
      }

      copyMdxFiles(docsDir, rawDir);
    },
  };
};
