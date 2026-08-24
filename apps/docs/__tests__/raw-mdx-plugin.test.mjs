import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import rawMdxPlugin from '../plugins/raw-mdx-plugin.js';

const siteDir = fileURLToPath(new URL('../', import.meta.url));

function createFakeResponse() {
  const calls = { statusCode: undefined, ended: false, headers: {}, body: undefined };
  const res = {
    status(code) {
      calls.statusCode = code;
      return res;
    },
    end() {
      calls.ended = true;
    },
    setHeader(name, value) {
      calls.headers[name] = value;
    },
    send(body) {
      calls.body = body;
      calls.ended = true;
    },
  };
  return { res, calls };
}

function getDevMiddlewareHandler() {
  const plugin = rawMdxPlugin({ siteDir, generatedFilesDir: path.join(siteDir, '.docusaurus') });
  const registered = [];
  plugin.configureWebpack().devServer.setupMiddlewares(registered);
  const rawMiddleware = registered.find((entry) => entry.name === 'raw-mdx');
  assert.ok(rawMiddleware, 'the raw-mdx devServer middleware must be registered');
  return rawMiddleware.middleware;
}

test('the dev middleware rejects a path-traversal request outside the docs directory', async () => {
  const middleware = getDevMiddlewareHandler();
  const { res, calls } = createFakeResponse();

  await middleware({ params: ['../../../../../../etc/passwd'] }, res);

  assert.equal(calls.statusCode, 403);
  assert.equal(calls.ended, true);
  assert.equal(calls.body, undefined, 'no file content must be sent for a rejected path');
});

test('the dev middleware rejects a traversal request that resolves to a non-Markdown file', async () => {
  const middleware = getDevMiddlewareHandler();
  const { res, calls } = createFakeResponse();

  await middleware({ params: ['../../../../../../package.json'] }, res);

  assert.equal(calls.statusCode, 403);
  assert.equal(calls.ended, true);
  assert.equal(calls.body, undefined);
});

test('the dev middleware serves an in-bounds Markdown source', async () => {
  const middleware = getDevMiddlewareHandler();
  const { res, calls } = createFakeResponse();

  await middleware({ params: ['introduction/overview.mdx'] }, res);

  assert.equal(calls.statusCode, undefined, 'a successful response must not set an error status');
  assert.equal(calls.ended, true);
  assert.equal(calls.headers['Content-Type'], 'text/plain; charset=utf-8');
  assert.ok(typeof calls.body === 'string' && calls.body.length > 0);
});
