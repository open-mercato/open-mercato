import assert from 'node:assert/strict';
import * as fileSystem from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const docusaurusRequire = createRequire(require.resolve('@docusaurus/core/package.json'));
const serverRequire = createRequire(docusaurusRequire.resolve('webpack-dev-server'));
const middlewareEntry = serverRequire.resolve('webpack-dev-middleware');
const getFilenameFromUrl = require(path.join(path.dirname(middlewareEntry), 'utils/getFilenameFromUrl.js'));

test('docs middleware confines non-slash publicPath requests to the output directory', (context) => {
  const fixturePath = fileSystem.mkdtempSync(path.join(tmpdir(), 'docs-middleware-security-'));
  context.after(() => fileSystem.rmSync(fixturePath, { recursive: true, force: true }));
  const outputPath = path.join(fixturePath, 'output');
  fileSystem.mkdirSync(outputPath);
  fileSystem.writeFileSync(path.join(outputPath, 'index.html'), 'public docs');
  fileSystem.writeFileSync(path.join(fixturePath, 'secret.txt'), 'private fixture');
  const middlewareContext = {
    options: { publicPath: '/static' },
    outputFileSystem: fileSystem,
    stats: {
      compilation: {
        options: {},
        outputOptions: { path: outputPath },
        getPath: (value) => value,
      },
    },
  };

  assert.equal(getFilenameFromUrl(middlewareContext, '/static/index.html'), path.join(outputPath, 'index.html'));

  for (const requestPath of ['/static../secret.txt', '/static%2e%2e/secret.txt', '/static/../secret.txt']) {
    const result = {};
    assert.equal(getFilenameFromUrl(middlewareContext, requestPath, result), undefined, requestPath);
    assert.equal(result.errorCode, 403, requestPath);
  }
});
