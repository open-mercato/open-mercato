const path = require('path');
const fs = require('fs');

/**
 * Docusaurus plugin that serves raw .mdx source files at /raw/<path>.mdx
 * so the "Copy page" button can fetch and copy the original Markdown source.
 *
 * - Production: copies .mdx files from docs/ into build/raw/ during postBuild
 * - Development: serves .mdx files via webpack devServer middleware
 */
module.exports = function rawMdxPlugin(context) {
  const docsDir = path.resolve(context.siteDir, 'docs');

  return {
    name: 'raw-mdx-plugin',

    configureWebpack(_config, _isServer) {
      return {
        devServer: {
          setupMiddlewares(middlewares) {
            middlewares.unshift({
              name: 'raw-mdx',
              path: '/raw/*',
              middleware(req, res) {
                // req.params[0] contains everything after /raw/
                const relativePath = req.params[0];
                const filePath = path.join(docsDir, relativePath);

                // Security: prevent directory traversal
                if (!filePath.startsWith(docsDir)) {
                  res.status(403).end();
                  return;
                }

                if (fs.existsSync(filePath)) {
                  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                  res.send(fs.readFileSync(filePath, 'utf-8'));
                } else {
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

      function copyDir(srcDir, destDir) {
        if (!fs.existsSync(srcDir)) return;
        fs.mkdirSync(destDir, { recursive: true });

        for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
          const srcPath = path.join(srcDir, entry.name);
          const destPath = path.join(destDir, entry.name);

          if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
          } else if (entry.name.endsWith('.mdx') || entry.name.endsWith('.md')) {
            fs.copyFileSync(srcPath, destPath);
          }
        }
      }

      copyDir(docsDir, rawDir);
    },
  };
};
