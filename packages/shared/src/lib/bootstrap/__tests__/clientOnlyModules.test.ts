import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  createClientOnlyStubPlugin,
  isClientOnlyModulePath,
  renderClientOnlyModuleStub,
} from '../clientOnlyModules'

const CHART_IMPORT = '@open-mercato/ui/backend/charts'

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
})

describe('renderClientOnlyModuleStub', () => {
  it('exports a default that throws when the browser component is actually used', () => {
    const stub = renderClientOnlyModuleStub('./widget.client')
    expect(stub).toContain('export default clientOnlyModuleUnavailable')
    expect(stub).toContain('./widget.client')
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
})
