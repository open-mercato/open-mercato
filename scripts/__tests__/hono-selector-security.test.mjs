import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
import { test } from 'node:test'
import semver from 'semver'
import { parse } from 'yaml'

const runNode = promisify(execFile)
const requireAssistant = createRequire(new URL('../../packages/ai-assistant/package.json', import.meta.url))
const requireDocs = createRequire(new URL('../../apps/docs/package.json', import.meta.url))

test('Dependabot 509, 298, 492 and 301 have no vulnerable lock resolutions', async () => {
  const lockfile = parse(await readFile(new URL('../../yarn.lock', import.meta.url), 'utf8'))
  const ranges = {
    '@hono/node-server': ['<2.1.3'],
    'postcss-selector-parser': ['>=7.0.0 <7.1.6'],
  }
  for (const [packageName, vulnerableRanges] of Object.entries(ranges)) {
    const versions = Object.entries(lockfile)
      .filter(([descriptor]) => descriptor.startsWith(`${packageName}@`))
      .map(([, entry]) => entry.version)
    assert.ok(versions.length > 0, `${packageName} must remain covered`)
    for (const version of versions) {
      assert.ok(!vulnerableRanges.some((range) => semver.satisfies(version, range)), `${packageName}@${version}`)
    }
  }
})

test('selector parser bounds flat class selectors and preserves their AST', async () => {
  const source = `
    const assert = require('node:assert/strict')
    const parser = require(process.argv[1])
    const selector = '.item'.repeat(80000)
    const ast = parser().astSync(selector)
    assert.equal(ast.first.nodes.length, 80000)
    assert.equal(ast.toString(), selector)
  `
  await runNode(process.execPath, ['-e', source, requireDocs.resolve('postcss-selector-parser')], {
    timeout: 5000,
    maxBuffer: 64 * 1024,
  })
})

test('MCP SDK resolves a compatible adapter and serves a Hono response', async () => {
  const requireSdk = createRequire(requireAssistant.resolve('@modelcontextprotocol/sdk/server/streamableHttp.js'))
  const { serve } = requireSdk('@hono/node-server')
  const { Hono } = requireSdk('hono')
  const app = new Hono()
  app.post('/echo', async (context) => context.json({ body: await context.req.json() }))
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
  try {
    if (!server.listening) await new Promise((resolve, reject) => {
      server.once('listening', resolve)
      server.once('error', reject)
    })
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const response = await fetch(`http://127.0.0.1:${address.port}/echo`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'adapter-compatible' }),
      signal: AbortSignal.timeout(5000),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { body: { message: 'adapter-compatible' } })
  } finally {
    server.closeAllConnections()
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
