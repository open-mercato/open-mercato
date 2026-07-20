/**
 * DS contract test for `mercato module scaffold` (spec:
 * .ai/specs/2026-07-05-ds-module-ui-scaffold.md §Testing layer 2).
 *
 * Two halves:
 * 1. Programmatic ESLint run with the repo's DS flat config
 *    (eslint.ds.config.mjs via fixtures/ds-flat-config.mjs, which only widens
 *    the `files` globs to the temp dir) → zero errors AND zero warnings.
 * 2. The guardian ANALYZE checklist markers from
 *    .ai/skills/om-ds-guardian/references/page-templates.md §DS Checklist,
 *    asserted directly on the generated sources. When the guardian gains a
 *    rule, this test fails until the templates comply.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { FULL_ARGS, createTmpRoot, readTree, runScaffold } from './helpers'

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..')
const DS_CONFIG = path.join(__dirname, 'fixtures', 'ds-flat-config.mjs')

let tmpDir: string
let moduleDir: string
let tree: Map<string, string>

beforeAll(async () => {
  tmpDir = createTmpRoot()
  const run = await runScaffold(tmpDir, FULL_ARGS)
  expect(run.errors).toEqual([])
  expect(run.code).toBe(0)
  moduleDir = path.join(tmpDir, 'apps', 'mercato', 'src', 'modules', 'inventory_items')
  tree = readTree(moduleDir)
})

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function fileOrThrow(relPath: string): string {
  const contents = tree.get(relPath)
  if (contents === undefined) throw new Error(`expected generated file ${relPath}`)
  return contents
}

function pageFiles(): Array<[string, string]> {
  return [...tree.entries()].filter(([relPath]) => relPath.endsWith('.tsx'))
}

function codeFiles(): Array<[string, string]> {
  return [...tree.entries()].filter(([relPath]) => relPath.endsWith('.ts') || relPath.endsWith('.tsx'))
}

describe('DS lint gate (repo eslint.ds config, programmatic run)', () => {
  it('generated pages produce zero errors and zero warnings', () => {
    const eslintBin = path.join(REPO_ROOT, 'node_modules', '.bin', 'eslint')
    const result = spawnSync(
      eslintBin,
      ['--no-config-lookup', '--config', DS_CONFIG, '--format', 'json', '.'],
      { cwd: moduleDir, encoding: 'utf8', timeout: 120_000 },
    )
    expect(result.error).toBeUndefined()
    const reports = JSON.parse(result.stdout || '[]') as Array<{
      filePath: string
      errorCount: number
      warningCount: number
      messages: Array<{ ruleId: string | null; message: string }>
    }>
    // Every generated page (and module file) must have been linted…
    const lintedPages = reports.filter((report) => report.filePath.endsWith('page.tsx'))
    expect(lintedPages).toHaveLength(3)
    // …with zero findings (the plugin runs at warn severity during rollout, so
    // warnings are failures here — the scaffold must be clean, not "tolerated").
    const findings = reports.flatMap((report) =>
      report.messages.map((message) => `${report.filePath}: ${message.ruleId ?? 'fatal'} ${message.message}`),
    )
    expect(findings).toEqual([])
    expect(reports.reduce((sum, report) => sum + report.errorCount + report.warningCount, 0)).toBe(0)
    expect(result.status).toBe(0)
  })
})

describe('guardian checklist markers', () => {
  it('list page renders EmptyState and passes isLoading to DataTable', () => {
    const listPage = fileOrThrow('backend/inventory_items/page.tsx')
    expect(listPage).toContain("import { EmptyState } from '@open-mercato/ui/primitives/empty-state'")
    expect(listPage).toContain('emptyState={(')
    expect(listPage).toContain('isLoading={isLoading}')
    expect(listPage).toContain('<Page>')
    expect(listPage).toContain('<PageBody>')
  })

  it('detail page uses LoadingMessage / ErrorMessage for the fetch lifecycle', () => {
    const detailPage = fileOrThrow('backend/inventory_items/[id]/page.tsx')
    expect(detailPage).toContain("import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'")
    expect(detailPage).toContain('<LoadingMessage label=')
    expect(detailPage).toContain('<ErrorMessage label=')
  })

  it('status is rendered through StatusBadge + the shared StatusMap module', () => {
    expect(tree.has('components/statusMap.ts')).toBe(true)
    const statusMap = fileOrThrow('components/statusMap.ts')
    expect(statusMap).toContain("import type { StatusMap } from '@open-mercato/ui/primitives/status-badge'")
    expect(statusMap).toContain("export type StockItemStatus = 'open' | 'in_progress' | 'closed'")
    const listPage = fileOrThrow('backend/inventory_items/page.tsx')
    expect(listPage).toContain('<StatusBadge variant={stockItemStatusMap[status]')
    const detailPage = fileOrThrow('backend/inventory_items/[id]/page.tsx')
    expect(detailPage).toContain('statusBadge={record.status ? (')
  })

  it('data flows through apiCall/crud helpers — never raw fetch', () => {
    for (const [relPath, contents] of codeFiles()) {
      expect(`${relPath}: ${contents}`).not.toMatch(/\bfetch\s*\(/)
    }
    const listPage = fileOrThrow('backend/inventory_items/page.tsx')
    expect(listPage).toContain("from '@open-mercato/ui/backend/utils/apiCall'")
  })

  it('metadata guards are present on every page.meta.ts', () => {
    const metas = [...tree.entries()].filter(([relPath]) => relPath.endsWith('page.meta.ts'))
    expect(metas).toHaveLength(3)
    for (const [, contents] of metas) {
      expect(contents).toContain('requireAuth: true')
      expect(contents).toMatch(/requireFeatures: \['inventory_items\.(view|create)'\]/)
      expect(contents).toContain('breadcrumb: [')
      expect(contents).toContain('pageTitleKey:')
      expect(contents).toContain('pageGroupKey:')
    }
  })

  it('uses semantic tokens only — no inline svg, arbitrary values, palette classes, dark: overrides or pill chips', () => {
    const forbidden: Array<[string, RegExp]> = [
      ['inline <svg>', /<svg/],
      ['arbitrary text size text-[', /text-\[/],
      ['dark: override', /dark:/],
      ['full-pill rounded-full', /rounded-full/],
      ['raw palette class', /(?:text|bg|border)-(?:red|green|blue|emerald|amber|yellow|sky|rose|lime|orange|slate|gray|zinc|stone)-\d/],
      ['hardcoded hex color', /#[0-9a-fA-F]{3,8}\b/],
    ]
    const violations: string[] = []
    for (const [relPath, contents] of codeFiles()) {
      for (const [label, pattern] of forbidden) {
        if (pattern.test(contents)) violations.push(`${relPath}: ${label}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('routes every user-facing string through t() with i18n keys emitted to all four locales', () => {
    for (const [relPath, contents] of pageFiles()) {
      expect(contents).toContain('useT()')
      // No literal JSX text nodes — all copy is {t('key', 'Fallback')}.
      const literalTextNodes = contents.match(/>\s*[A-Za-z][A-Za-z ,.']*</g) ?? []
      expect(`${relPath}: ${literalTextNodes.join(' | ')}`).toBe(`${relPath}: `)
    }

    const en = JSON.parse(fileOrThrow('i18n/en.json')) as Record<string, string>
    for (const locale of ['pl', 'es', 'de']) {
      const dict = JSON.parse(fileOrThrow(`i18n/${locale}.json`)) as Record<string, string>
      expect(Object.keys(dict).sort()).toEqual(Object.keys(en).sort())
    }

    // Every t('<key>', ...) key referenced with a literal is present in en.json.
    // Keys ending with '.' are dynamic prefixes (e.g. status option lookups);
    // their concrete variants are asserted via the option keys below.
    const referenced = new Set<string>()
    for (const [, contents] of codeFiles()) {
      for (const match of contents.matchAll(/t\('([a-zA-Z0-9_.]+)'/g)) {
        if (!match[1].endsWith('.')) referenced.add(match[1])
      }
    }
    const missing = [...referenced].filter((key) => !(key in en)).sort()
    expect(missing).toEqual([])
    expect(en['inventory_items.fields.status.options.in_progress']).toBe('In progress')
    expect(en['inventory_items.fields.severity.options.high']).toBe('High')
  })

  it('edit flows through CrudForm with initialValues.updatedAt (optimistic locking default-ON)', () => {
    const detailPage = fileOrThrow('backend/inventory_items/[id]/page.tsx')
    expect(detailPage).toContain('updatedAt: record.updatedAt ?? undefined,')
    expect(detailPage).toContain('<CrudForm<StockItemUpdateInput>')
    expect(detailPage).toContain('initialValues={initialValues}')
    const validators = fileOrThrow('data/validators.ts')
    expect(validators).toContain('`updatedAt`')
    expect(validators).toContain('`updated_at`')
  })

  it('row actions use stable ids with confirm dialog + flash', () => {
    const listPage = fileOrThrow('backend/inventory_items/page.tsx')
    expect(listPage).toContain("id: 'edit',")
    expect(listPage).toContain("id: 'delete',")
    expect(listPage).toContain('useConfirmDialog()')
    expect(listPage).toContain("flash(t('inventory_items.delete.success'")
  })

  it('keeps pageSize at or below 100', () => {
    const listPage = fileOrThrow('backend/inventory_items/page.tsx')
    const match = listPage.match(/const PAGE_SIZE = (\d+)/)
    expect(match).not.toBeNull()
    expect(Number(match?.[1])).toBeLessThanOrEqual(100)
  })
})
