import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  createClientOnlyStubPlugin,
  encodeJsStringLiteral,
  isClientOnlyModulePath,
  renderClientOnlyModuleStub,
} from '../clientOnlyModules'
import { createCliBundlePlugins } from '../dynamicLoader'

const CHART_IMPORT = '@open-mercato/ui/backend/charts'

function createServerHelperFixture(tempDir: string): string {
  const moduleDir = path.join(tempDir, 'src', 'modules', 'demo')
  fs.mkdirSync(moduleDir, { recursive: true })

  fs.writeFileSync(
    path.join(moduleDir, 'http.client.ts'),
    ['export const httpClient = { fetchOrders: async () => [] }', ''].join('\n'),
  )

  const entry = path.join(tempDir, 'modules.cli.generated.ts')
  fs.writeFileSync(
    entry,
    [
      "import { httpClient } from './src/modules/demo/http.client'",
      'export const modules = [{',
      "  id: 'demo',",
      '  workers: [{ handler: () => httpClient.fetchOrders() }],',
      '}]',
      '',
    ].join('\n'),
  )

  return entry
}

function createAppModuleFixture(tempDir: string): string {
  const widgetDir = path.join(tempDir, 'src', 'modules', 'demo', 'widgets', 'dashboard', 'sales')
  fs.mkdirSync(widgetDir, { recursive: true })

  fs.writeFileSync(
    path.join(widgetDir, 'widget.client.tsx'),
    [
      '"use client"',
      `import { BarChart } from '${CHART_IMPORT}'`,
      'export default function DemoWidget() { return BarChart }',
      '',
    ].join('\n'),
  )

  const entry = path.join(tempDir, 'modules.cli.generated.ts')
  fs.writeFileSync(
    entry,
    [
      'export const modules = [{',
      "  id: 'demo',",
      '  dashboardWidgets: [{',
      "    moduleId: 'demo',",
      "    key: 'demo:sales:widget',",
      "    loader: () => import('./src/modules/demo/widgets/dashboard/sales/widget.client').then((mod) => mod.default ?? mod),",
      '  }],',
      '}]',
      '',
    ].join('\n'),
  )

  return entry
}

async function bundle(entry: string, outfile: string, withStubPlugin: boolean): Promise<string> {
  const esbuild = await import('esbuild')
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    external: ['@open-mercato/*'],
    plugins: withStubPlugin ? [createClientOnlyStubPlugin()] : [],
  })
  return fs.readFileSync(outfile, 'utf8')
}

describe('isClientOnlyModulePath', () => {
  it('matches local client modules with and without an extension', () => {
    expect(isClientOnlyModulePath('./widget.client')).toBe(true)
    expect(isClientOnlyModulePath('./widget.client.tsx')).toBe(true)
    expect(isClientOnlyModulePath('../dashboard/sales/widget.client.ts')).toBe(true)
    expect(isClientOnlyModulePath('@/modules/demo/widgets/dashboard/sales/widget.client')).toBe(true)
    expect(isClientOnlyModulePath('./notifications.client.ts')).toBe(true)
  })

  it('leaves bare package specifiers to the external-import plugin', () => {
    expect(isClientOnlyModulePath('@open-mercato/ui/backend/charts')).toBe(false)
    expect(isClientOnlyModulePath('@open-mercato/core/modules/demo/widget.client')).toBe(false)
    expect(isClientOnlyModulePath('react')).toBe(false)
  })

  it('does not match server modules that merely mention client', () => {
    expect(isClientOnlyModulePath('./widget.ts')).toBe(false)
    expect(isClientOnlyModulePath('./clientFactory.ts')).toBe(false)
    expect(isClientOnlyModulePath('./client/index.ts')).toBe(false)
  })

  it('does not match the generated notification-renderer registry', () => {
    expect(isClientOnlyModulePath('@/.mercato/generated/notifications.client.generated')).toBe(false)
    expect(isClientOnlyModulePath('@/.mercato/generated/notifications.client.generated.ts')).toBe(false)
  })
})

describe('encodeJsStringLiteral', () => {
  it('escapes quotes and backslashes so the literal cannot be terminated early', () => {
    expect(encodeJsStringLiteral('say "hi"')).toBe('"say \\"hi\\""')
    expect(encodeJsStringLiteral('a\\b')).toBe('"a\\\\b"')
  })

  it('escapes every character outside printable ASCII, including the separators JSON leaves raw', () => {
    expect(encodeJsStringLiteral('a\u2028b')).toBe('"a\\u2028b"')
    expect(encodeJsStringLiteral('a\u2029b')).toBe('"a\\u2029b"')
    expect(encodeJsStringLiteral('a\nb')).toBe('"a\\u000ab"')
  })

  it('leaves no unescaped delimiter that could break out of the literal', () => {
    const hostile = './widget.client"); globalThis.pwned = true; ("'
    const encoded = encodeJsStringLiteral(hostile)

    expect(encoded.startsWith('"')).toBe(true)
    expect(encoded.endsWith('"')).toBe(true)
    expect(encoded.slice(1, -1)).not.toMatch(/(^|[^\\])"/)
    expect(JSON.parse(encoded)).toBe(hostile)
  })
})

describe('renderClientOnlyModuleStub', () => {
  it('exports a default that throws when the browser component is actually used', () => {
    const stub = renderClientOnlyModuleStub('./widget.client')
    expect(stub).toContain('export default clientOnlyModuleUnavailable')
    expect(stub).toContain('./widget.client')
  })
})

describe('createCliBundlePlugins', () => {
  it('registers the client-only stub ahead of the alias and external plugins', () => {
    expect(createCliBundlePlugins('/tmp/app-root').map((plugin) => plugin.name)).toEqual([
      'client-only-stub',
      'alias-resolver',
      'external-non-json',
    ])
  })
})

describe('CLI bundle graph', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'open-mercato-client-only-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('keeps browser-only widget imports out of the CLI bundle', async () => {
    const entry = createAppModuleFixture(tempDir)
    const output = await bundle(entry, path.join(tempDir, 'stubbed.mjs'), true)

    expect(output).not.toContain(CHART_IMPORT)
    expect(output).toContain('clientOnlyModuleUnavailable')
  })

  it('without the plugin the same fixture hoists the browser-only import (regression guard)', async () => {
    const entry = createAppModuleFixture(tempDir)
    const output = await bundle(entry, path.join(tempDir, 'plain.mjs'), false)

    expect(output).toContain(CHART_IMPORT)
  })

  it('leaves statically imported server helpers alone even when they are named *.client', async () => {
    const entry = createServerHelperFixture(tempDir)
    const output = await bundle(entry, path.join(tempDir, 'server-helper.mjs'), true)

    expect(output).toContain('fetchOrders')
    expect(output).not.toContain('clientOnlyModuleUnavailable')
  })
})
