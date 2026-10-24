import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const server = fileURLToPath(new URL('../../agentic/shared/scripts/agent-harness-tool-server.mjs', import.meta.url))
const sharedInstructions = 'node_modules/@open-mercato/shared/AGENTS.md'
const sharedInstructionSource = fileURLToPath(new URL('../../../shared/AGENTS.md', import.meta.url))

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

test('the real harness MCP tool exposes no process, environment, discovery, or network capability', () => {
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

for (const linked of [false, true]) {
  test(`the MCP delivers only the exact declared shared instruction and never writes it, linked dependencies=${linked}`, () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-harness-instruction-')))
    const dependencies = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-harness-instruction-deps-')))
    const dependencyRoot = linked ? dependencies : path.join(root, 'node_modules')
    const instruction = path.join(dependencyRoot, '@open-mercato', 'shared', 'AGENTS.md')
    fs.mkdirSync(path.dirname(instruction), { recursive: true })
    fs.copyFileSync(sharedInstructionSource, instruction)
    fs.writeFileSync(path.join(root, 'AGENTS.md'), '# App\n')
    if (linked) fs.symlinkSync(dependencies, path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
    const original = fs.readFileSync(instruction, 'utf8')
    try {
      const replies = call(root, 'writable', [sharedInstructions], ['src/**'], [
        { name: 'read', arguments: { path: sharedInstructions } },
        { name: 'write', arguments: { path: sharedInstructions, content: 'tampered' } },
        ...['node_modules/@open-mercato/shared/README.md', 'node_modules/@open-mercato/core/AGENTS.md', 'node_modules/@open-mercato/shared/.env', 'node_modules/@open-mercato/shared/../shared/AGENTS.md', 'node_modules/@open-mercato/shared/*'].map((target) => ({ name: 'read', arguments: { path: target } })),
      ])
      assert.equal(replies[2].result.content[0].text, original)
      for (const reply of replies.slice(3)) assert.equal(reply.result.isError, true)
      assert.equal(fs.readFileSync(instruction, 'utf8'), original)
      const undeclared = call(root, 'read-only', ['AGENTS.md'], [], [{ name: 'read', arguments: { path: sharedInstructions } }])
      assert.equal(undeclared[2].result.isError, true)
      for (const [reads, writes] of [
        [[sharedInstructions], [sharedInstructions]],
        [['node_modules/@open-mercato/shared/*'], []],
        [['node_modules/@open-mercato/core/AGENTS.md'], []],
        [['node_modules/@open-mercato/shared/README.md'], []],
      ]) {
        const result = spawnSync(process.execPath, [server, root, 'writable', JSON.stringify(reads), JSON.stringify(writes)], { encoding: 'utf8', env: {} })
        assert.equal(result.status, 2, result.stderr)
      }
      for (const shape of ['directory', 'symlink', 'escaping-symlink']) {
        fs.rmSync(instruction)
        if (shape === 'directory') fs.mkdirSync(instruction)
        else {
          const target = path.join(shape === 'escaping-symlink' ? root : dependencyRoot, 'other-instructions.md')
          fs.writeFileSync(target, 'must-not-be-returned')
          fs.symlinkSync(target, instruction)
        }
        const denied = call(root, 'read-only', [sharedInstructions], [], [{ name: 'read', arguments: { path: sharedInstructions } }])
        assert.equal(denied[2].result.isError, true, shape)
        assert.doesNotMatch(JSON.stringify(denied), /must-not-be-returned/)
        fs.rmSync(instruction, { recursive: true })
        fs.writeFileSync(instruction, original)
      }
      const packageRoot = path.dirname(instruction)
      const otherPackage = path.join(path.dirname(packageRoot), 'other')
      fs.renameSync(packageRoot, otherPackage)
      fs.symlinkSync(otherPackage, packageRoot, process.platform === 'win32' ? 'junction' : 'dir')
      const aliased = call(root, 'read-only', [sharedInstructions], [], [{ name: 'read', arguments: { path: sharedInstructions } }])
      assert.equal(aliased[2].result.isError, true)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(dependencies, { recursive: true, force: true })
    }
  })
}

for (const linked of [false, true]) {
  test(`the MCP initializes and reads only the exact declared Code Connect source, linked dependencies=${linked}`, () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-harness-auxiliary-')))
    const dependencies = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-harness-auxiliary-deps-')))
    const dependencyRoot = linked ? dependencies : path.join(root, 'node_modules')
    const relative = 'node_modules/@open-mercato/ui/figma/button.figma.tsx'
    const source = path.join(dependencyRoot, '@open-mercato/ui/figma/button.figma.tsx')
    const original = 'export const codeConnect = "exact-button-source"\n'
    fs.mkdirSync(path.dirname(source), { recursive: true })
    fs.writeFileSync(source, original)
    fs.writeFileSync(path.join(root, 'AGENTS.md'), '# App\n')
    if (linked) fs.symlinkSync(dependencies, path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
    try {
      const deniedPaths = [
        'node_modules/@open-mercato/ui/figma/other.figma.tsx',
        'node_modules/@open-mercato/ui/figma/*.figma.tsx',
        'node_modules/@open-mercato/other/figma/button.figma.tsx',
        'node_modules/@open-mercato/ui/figma/../figma/button.figma.tsx',
        'node_modules/@open-mercato/ui/figma/.env',
      ]
      const replies = call(root, 'writable', [relative], ['src/**'], [
        { name: 'read', arguments: { path: relative } },
        { name: 'write', arguments: { path: relative, content: 'tampered' } },
        ...deniedPaths.map((target) => ({ name: 'read', arguments: { path: target } })),
      ])
      assert.equal(replies[0].id, 1)
      assert.equal(replies[2].result.content[0].text, original)
      for (const reply of replies.slice(3)) assert.equal(reply.result.isError, true)
      assert.equal(fs.readFileSync(source, 'utf8'), original)
      const undeclared = call(root, 'read-only', ['AGENTS.md'], [], [{ name: 'read', arguments: { path: relative } }])
      assert.equal(undeclared[2].result.isError, true)
      for (const [reads, writes] of [[[relative], [relative]], ...deniedPaths.map((target) => [[target], []])]) {
        const result = spawnSync(process.execPath, [server, root, 'writable', JSON.stringify(reads), JSON.stringify(writes)], { encoding: 'utf8', env: {} })
        assert.equal(result.status, 2, result.stderr)
      }
      for (const shape of ['directory', 'inside-symlink', 'escaping-symlink']) {
        fs.rmSync(source)
        if (shape === 'directory') fs.mkdirSync(source)
        else {
          const target = path.join(shape === 'escaping-symlink' ? root : dependencyRoot, 'other-source.tsx')
          fs.writeFileSync(target, 'must-not-be-returned')
          fs.symlinkSync(target, source)
        }
        const denied = call(root, 'read-only', [relative], [], [{ name: 'read', arguments: { path: relative } }])
        assert.equal(denied[2].result.isError, true, shape)
        assert.doesNotMatch(JSON.stringify(denied), /must-not-be-returned/)
        fs.rmSync(source, { recursive: true })
        fs.writeFileSync(source, original)
      }
      const packageRoot = path.join(dependencyRoot, '@open-mercato/ui')
      const alias = path.join(dependencyRoot, '@open-mercato/other')
      fs.renameSync(packageRoot, alias)
      fs.symlinkSync(alias, packageRoot, process.platform === 'win32' ? 'junction' : 'dir')
      const aliased = call(root, 'read-only', [relative], [], [{ name: 'read', arguments: { path: relative } }])
      assert.equal(aliased[2].result.isError, true)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(dependencies, { recursive: true, force: true })
    }
  })
}

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
