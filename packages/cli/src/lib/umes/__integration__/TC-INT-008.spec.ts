import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..')
const cliListEntry = path.join(repoRoot, 'packages', 'cli', 'dist', 'lib', 'umes', 'list.js')
const sharedBooleanEntry = path.join(repoRoot, 'packages', 'shared', 'dist', 'lib', 'boolean.js')

function yarnBinary(): string {
  return process.platform === 'win32' ? 'yarn.cmd' : 'yarn'
}

function runCommand(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NODE_NO_WARNINGS: '1',
    },
  })
}

function ensureUmesListRuntimeBuilt(): void {
  if (!fs.existsSync(sharedBooleanEntry)) {
    runCommand(yarnBinary(), ['workspace', '@open-mercato/shared', 'build'], repoRoot)
  }

  if (!fs.existsSync(cliListEntry)) {
    runCommand(yarnBinary(), ['workspace', '@open-mercato/cli', 'build'], repoRoot)
  }
}

function runUmesList(cwd: string): string {
  const script = `import { runUmesList } from ${JSON.stringify(cliListEntry)}; await runUmesList();`
  return runCommand(process.execPath, ['--input-type=module', '--eval', script], cwd)
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

function createFixture(modulesSource: string, files: Record<string, string>): string {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-umes-list-'))
  writeFile(path.join(rootDir, 'src', 'modules.ts'), modulesSource)

  for (const [relativePath, content] of Object.entries(files)) {
    writeFile(path.join(rootDir, relativePath), content)
  }

  return rootDir
}

test.describe('TC-INT-008: UMES list command output', () => {
  test.beforeAll(() => {
    ensureUmesListRuntimeBuilt()
  })

  test('prints the empty state when enabled modules expose no UMES extensions', () => {
    const rootDir = createFixture(
      "export const enabledModules = [{ id: 'empty', from: '@app' }]\n",
      {},
    )

    try {
      expect(runUmesList(rootDir)).toBe('No UMES extensions found.\n')
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true })
    }
  })

  test('renders the formatted extension table and summary for discovered entries', () => {
    const rootDir = createFixture(
      [
        'export const enabledModules = [',
        "  { id: 'alpha', from: '@app' },",
        "  { id: 'beta_mod', from: '@app' },",
        ']',
        '',
      ].join('\n'),
      {
        'src/modules/alpha/data/enrichers.js': [
          'exports.enrichers = [',
          '  {',
          "    id: 'alpha.enrich',",
          "    targetEntity: 'orders',",
          '    priority: 7,',
          "    features: ['alpha.view'],",
          '  },',
          ']',
          '',
        ].join('\n'),
        'src/modules/alpha/widgets/components.js': [
          'exports.componentOverrides = [',
          '  {',
          "    target: { componentId: 'page:orders' },",
          '    priority: 9,',
          '    replacement: {},',
          "    features: ['alpha.view'],",
          '  },',
          ']',
          '',
        ].join('\n'),
        'src/modules/beta_mod/api/interceptors.js': [
          'exports.interceptors = [',
          '  {',
          "    id: 'beta.guard',",
          "    targetRoute: '/orders',",
          "    methods: ['GET', 'PATCH'],",
          '    priority: 3,',
          '  },',
          ']',
          '',
        ].join('\n'),
        'src/modules/beta_mod/widgets/injection-table.js': [
          'exports.injectionTable = {',
          "  'data-table:orders:columns': [",
          "    { widgetId: 'beta.orders.column', priority: 4 },",
          '  ],',
          '}',
          '',
        ].join('\n'),
      },
    )

    try {
      const outputLines = runUmesList(rootDir)
        .trimEnd()
        .split('\n')
        .map((line) => line.replace(/\s+$/u, ''))

      expect(outputLines).toEqual([
        ' Module   │ Type               │ ID                 │ Target                    │ Priority │ Features',
        '──────────┼────────────────────┼────────────────────┼───────────────────────────┼──────────┼────────────',
        ' alpha    │ enricher           │ alpha.enrich       │ orders                    │ 7        │ alpha.view',
        ' alpha    │ component-override │ alpha.page:orders  │ page:orders               │ 9        │ alpha.view',
        ' beta_mod │ interceptor        │ beta.guard         │ GET,PATCH /orders         │ 3        │',
        ' beta_mod │ injection-widget   │ beta.orders.column │ data-table:orders:columns │ 4        │',
        '',
        'Total: 4 extension(s) across 2 module(s)',
      ])
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true })
    }
  })
})
