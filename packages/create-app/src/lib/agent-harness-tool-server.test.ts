import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const server = fileURLToPath(new URL('../../agentic/shared/scripts/agent-harness-tool-server.mjs', import.meta.url))

function call(
  root: string,
  mode: 'read-only' | 'writable',
  allowedReads: string[],
  allowedWrites: string[],
  calls: Array<{ name: string; arguments: Record<string, unknown> }>,
) {
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ...calls.map((entry, index) => ({ jsonrpc: '2.0', id: index + 3, method: 'tools/call', params: entry })),
  ]
  const result = spawnSync(process.execPath, [server, root, mode, JSON.stringify(allowedReads), JSON.stringify(allowedWrites)], {
    input: `${messages.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
    encoding: 'utf8',
    env: {},
  })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim().split('\n').map((line) => JSON.parse(line))
}

test('the real harness MCP tool exposes no process, environment, discovery, or network capability', { skip: process.platform === 'win32' }, () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-harness-mcp-root-')))
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-harness-mcp-secret-')))
  const credential = path.join(outside, 'auth.json')
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# safe\n')
  fs.mkdirSync(path.join(root, 'config'))
  fs.writeFileSync(path.join(root, 'config', 'secrets.json'), '{"token":"local-secret"}\n')
  fs.writeFileSync(credential, '{"token":"must-not-be-readable"}\n')
  fs.symlinkSync(credential, path.join(root, 'credential-link'))
  try {
    const replies = call(root, 'read-only', ['AGENTS.md'], [], [
      { name: 'read', arguments: { path: 'AGENTS.md' } },
      { name: 'read', arguments: { path: credential } },
      { name: 'read', arguments: { path: 'credential-link' } },
      { name: 'read', arguments: { path: '/proc/self/environ' } },
      { name: 'read', arguments: { path: 'config/secrets.json' } },
      { name: 'fetch_url', arguments: { url: 'https://example.com/exfiltrate' } },
      { name: 'write', arguments: { path: 'owned.ts', content: 'unsafe' } },
    ])
    assert.deepEqual(replies[1].result.tools.map((entry: { name: string }) => entry.name), ['read'])
    assert.equal(replies[2].result.content[0].text, '# safe\n')
    for (const reply of replies.slice(3)) assert.equal(reply.result.isError, true)
    assert.doesNotMatch(JSON.stringify(replies), /must-not-be-readable/)
    assert.equal(fs.existsSync(path.join(root, 'owned.ts')), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  }
})

test('the MCP read allowlist rejects readable source before returning its content', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-harness-mcp-disclosure-')))
  fs.mkdirSync(path.join(root, 'src'))
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# allowed\n')
  fs.writeFileSync(path.join(root, 'src', 'private.ts'), 'export const marker = "never-return-this-source"\n')
  try {
    const replies = call(root, 'read-only', ['AGENTS.md'], [], [
      { name: 'read', arguments: { path: 'src/private.ts' } },
      { name: 'read', arguments: { path: 'AGENTS.md' } },
    ])
    assert.equal(replies[2].result.isError, true)
    assert.match(replies[2].result.content[0].text, /outside the case read allowlist/)
    assert.equal(replies[3].result.content[0].text, '# allowed\n')
    assert.doesNotMatch(JSON.stringify(replies), /never-return-this-source/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('the MCP allows exact fact-linked installed source reads but not dependency discovery or writes', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-harness-mcp-installed-root-')))
  const dependencies = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-harness-mcp-installed-deps-')))
  const sourceFile = path.join(
    dependencies,
    '@open-mercato',
    'core',
    'src',
    'modules',
    'customers',
    'api',
    'people',
    'route.ts',
  )
  fs.mkdirSync(path.dirname(sourceFile), { recursive: true })
  fs.writeFileSync(sourceFile, 'export async function GET() { return new Response() }\n')
  fs.mkdirSync(path.join(dependencies, '@open-mercato', 'core', 'dist'), { recursive: true })
  fs.writeFileSync(path.join(dependencies, '@open-mercato', 'core', 'dist', 'secret.js'), 'not-source\n')
  fs.symlinkSync(dependencies, path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  try {
    const allowedSource = 'node_modules/@open-mercato/core/src/modules/customers/api/people/route.ts'
    const replies = call(
      root,
      'read-only',
      ['node_modules/@open-mercato/*/src/**'],
      [],
      [
        { name: 'read', arguments: { path: allowedSource } },
        { name: 'read', arguments: { path: 'node_modules/@open-mercato/core/src' } },
        { name: 'read', arguments: { path: 'node_modules/@open-mercato/core/dist/secret.js' } },
        { name: 'read', arguments: { path: 'node_modules/example/index.js' } },
        { name: 'write', arguments: { path: allowedSource, content: 'tampered\n' } },
      ],
    )
    assert.match(replies[2].result.content[0].text, /export async function GET/)
    for (const reply of replies.slice(3)) assert.equal(reply.result.isError, true)
    assert.match(fs.readFileSync(sourceFile, 'utf8'), /export async function GET/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(dependencies, { recursive: true, force: true })
  }
})

test('the writable MCP tool atomically changes only declared contained regular files', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-harness-mcp-write-')))
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-harness-mcp-write-outside-')))
  fs.mkdirSync(path.join(root, 'src'))
  fs.symlinkSync(outside, path.join(root, 'src', 'escape'))
  try {
    const replies = call(root, 'writable', ['src/modules/**'], ['src/modules/example.ts'], [
      { name: 'write', arguments: { path: 'src/modules/example.ts', content: 'export const value = 1\n' } },
      { name: 'read', arguments: { path: 'src/modules/example.ts' } },
      { name: 'write', arguments: { path: 'src/other.ts', content: 'unsafe\n' } },
      { name: 'write', arguments: { path: 'src/escape/outside.ts', content: 'unsafe\n' } },
    ])
    assert.deepEqual(replies[1].result.tools.map((entry: { name: string }) => entry.name), ['read', 'write'])
    assert.equal(replies[2].result.isError, undefined)
    assert.equal(replies[3].result.content[0].text, 'export const value = 1\n')
    assert.equal(replies[4].result.isError, true)
    assert.equal(replies[5].result.isError, true)
    assert.equal(fs.readFileSync(path.join(root, 'src', 'modules', 'example.ts'), 'utf8'), 'export const value = 1\n')
    assert.equal(fs.existsSync(path.join(outside, 'outside.ts')), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  }
})
