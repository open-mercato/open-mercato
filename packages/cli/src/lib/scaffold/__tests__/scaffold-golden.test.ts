/**
 * Golden-file tests for `mercato module scaffold` (spec:
 * .ai/specs/2026-07-05-ds-module-ui-scaffold.md §Testing layer 1).
 *
 * Every emitted file is pinned as a jest snapshot — an intentional template
 * change updates snapshots via `--updateSnapshot` and therefore always shows
 * up in review diffs; a template edit can never ship invisibly.
 *
 * To update snapshots after an intentional change:
 *   npx jest --updateSnapshot scaffold-golden
 */
import fs from 'node:fs'
import path from 'node:path'
import { FieldDslError, parseFieldsSpec } from '../field-dsl'
import { FULL_ARGS, createTmpRoot, readTree, runScaffold } from './helpers'

const tmpRoots: string[] = []

function tmpRoot(): string {
  const root = createTmpRoot()
  tmpRoots.push(root)
  return root
}

afterAll(() => {
  for (const root of tmpRoots) fs.rmSync(root, { recursive: true, force: true })
})

const APP_MODULE_DIR = ['apps', 'mercato', 'src', 'modules', 'inventory_items']
const CORE_MODULE_DIR = ['packages', 'core', 'src', 'modules', 'inventory_items']

describe('scaffold golden files', () => {
  it('emits the full DS-compliant UI slice for every field type (app target)', async () => {
    const root = tmpRoot()
    const run = await runScaffold(root, FULL_ARGS)
    expect(run.errors).toEqual([])
    expect(run.code).toBe(0)

    const tree = readTree(path.join(root, ...APP_MODULE_DIR))
    expect([...tree.keys()].sort()).toEqual([
      'acl.ts',
      'backend/inventory_items/[id]/page.meta.ts',
      'backend/inventory_items/[id]/page.tsx',
      'backend/inventory_items/create/page.meta.ts',
      'backend/inventory_items/create/page.tsx',
      'backend/inventory_items/page.meta.ts',
      'backend/inventory_items/page.tsx',
      'components/formConfig.ts',
      'components/statusMap.ts',
      'data/validators.ts',
      'i18n/de.json',
      'i18n/en.json',
      'i18n/es.json',
      'i18n/pl.json',
      'index.ts',
      'setup.ts',
    ])

    for (const [relPath, contents] of [...tree.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      expect(contents).toMatchSnapshot(relPath)
    }

    // Non-English locales carry the identical key set with English values and
    // are flagged as "needs translation" in the summary.
    expect(tree.get('i18n/pl.json')).toBe(tree.get('i18n/en.json'))
    expect(tree.get('i18n/es.json')).toBe(tree.get('i18n/en.json'))
    expect(tree.get('i18n/de.json')).toBe(tree.get('i18n/en.json'))
    expect(run.output).toContain('needs translation')
  })

  it('scaffolds identical contents into the packages/core target shape', async () => {
    const appRoot = tmpRoot()
    const coreRoot = tmpRoot()
    const appRun = await runScaffold(appRoot, FULL_ARGS)
    const coreRun = await runScaffold(coreRoot, [...FULL_ARGS, '--target', 'packages/core'])
    expect(appRun.code).toBe(0)
    expect(coreRun.code).toBe(0)

    expect(fs.existsSync(path.join(appRoot, ...APP_MODULE_DIR, 'backend', 'inventory_items', 'page.tsx'))).toBe(true)
    expect(fs.existsSync(path.join(coreRoot, ...CORE_MODULE_DIR, 'backend', 'inventory_items', 'page.tsx'))).toBe(true)

    // Only the location differs between targets — file-by-file bytes are identical.
    const appTree = readTree(path.join(appRoot, ...APP_MODULE_DIR))
    const coreTree = readTree(path.join(coreRoot, ...CORE_MODULE_DIR))
    expect([...coreTree.entries()]).toEqual([...appTree.entries()])

    // The next-steps registration hint follows the target.
    expect(appRun.output).toContain("from: '@app'")
    expect(coreRun.output).toContain("from: '@open-mercato/core'")
  })

  it('omits statusMap and StatusBadge when no select field is named status', async () => {
    const root = tmpRoot()
    const run = await runScaffold(root, [
      'notes',
      '--entity',
      'note',
      '--fields',
      'title:text:required,body:textarea',
    ])
    expect(run.code).toBe(0)
    const tree = readTree(path.join(root, 'apps', 'mercato', 'src', 'modules', 'notes'))
    expect(tree.has('components/statusMap.ts')).toBe(false)
    const listPage = tree.get('backend/notes/page.tsx') ?? ''
    expect(listPage).not.toContain('StatusBadge')
    expect(listPage).not.toContain('statusMap')
    // No select fields → no quick-filter surface either.
    expect(listPage).not.toContain('FilterDef')
    expect(tree.get('backend/notes/[id]/page.tsx') ?? '').not.toContain('StatusBadge')
    for (const [relPath, contents] of [...tree.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      expect(contents).toMatchSnapshot(`no-status ${relPath}`)
    }
  })

  it('generates acl/setup/index only when absent and reports expected features', async () => {
    const root = tmpRoot()
    const moduleDir = path.join(root, ...APP_MODULE_DIR)
    fs.mkdirSync(moduleDir, { recursive: true })
    const preexisting = {
      'acl.ts': '// user acl\n',
      'setup.ts': '// user setup\n',
      'index.ts': '// user index\n',
    }
    for (const [name, contents] of Object.entries(preexisting)) {
      fs.writeFileSync(path.join(moduleDir, name), contents)
    }

    const run = await runScaffold(root, FULL_ARGS)
    expect(run.code).toBe(0)
    for (const [name, contents] of Object.entries(preexisting)) {
      expect(fs.readFileSync(path.join(moduleDir, name), 'utf8')).toBe(contents)
    }
    expect(run.output).toContain('Skipped (already present, left untouched):')
    expect(run.output).toContain(
      'pages expect features: inventory_items.view, inventory_items.create, inventory_items.edit, inventory_items.delete',
    )
  })

  it('never overwrites — re-running onto existing files aborts with the conflict list', async () => {
    const root = tmpRoot()
    const first = await runScaffold(root, FULL_ARGS)
    expect(first.code).toBe(0)
    const before = readTree(path.join(root, ...APP_MODULE_DIR))

    const second = await runScaffold(root, FULL_ARGS)
    expect(second.code).toBe(1)
    expect(second.output).toContain('Scaffold aborted')
    expect(second.output).toContain('backend/inventory_items/page.tsx')
    expect(second.output).toContain('No files were written.')

    const after = readTree(path.join(root, ...APP_MODULE_DIR))
    expect([...after.entries()]).toEqual([...before.entries()])
  })

  it('honors --features-prefix in metas, acl and setup', async () => {
    const root = tmpRoot()
    const run = await runScaffold(root, [...FULL_ARGS, '--features-prefix', 'inventory_items.stock'])
    expect(run.code).toBe(0)
    const tree = readTree(path.join(root, ...APP_MODULE_DIR))
    expect(tree.get('backend/inventory_items/page.meta.ts')).toContain("requireFeatures: ['inventory_items.stock.view']")
    expect(tree.get('backend/inventory_items/create/page.meta.ts')).toContain(
      "requireFeatures: ['inventory_items.stock.create']",
    )
    expect(tree.get('acl.ts')).toContain("id: 'inventory_items.stock.edit'")
    expect(tree.get('setup.ts')).toContain("superadmin: ['inventory_items.stock.*']")
  })
})

describe('scaffold determinism', () => {
  it('produces byte-identical output for identical inputs', async () => {
    const rootA = tmpRoot()
    const rootB = tmpRoot()
    const runA = await runScaffold(rootA, FULL_ARGS)
    const runB = await runScaffold(rootB, FULL_ARGS)
    expect(runA.code).toBe(0)
    expect(runB.code).toBe(0)
    expect([...readTree(path.join(rootB, ...APP_MODULE_DIR)).entries()]).toEqual(
      [...readTree(path.join(rootA, ...APP_MODULE_DIR)).entries()],
    )
  })

  it('prints an identical --dry-run plan on re-run and writes nothing', async () => {
    const root = tmpRoot()
    const first = await runScaffold(root, [...FULL_ARGS, '--dry-run'])
    const second = await runScaffold(root, [...FULL_ARGS, '--dry-run'])
    expect(first.code).toBe(0)
    expect(second.code).toBe(0)
    expect(first.output).toBe(second.output)
    expect(first.output).toContain('+ backend/inventory_items/page.tsx')
    expect(fs.existsSync(path.join(root, ...APP_MODULE_DIR))).toBe(false)
  })
})

describe('scaffold hostile inputs', () => {
  const base = (fields: string) => ['tickets', '--entity', 'ticket', '--fields', fields]

  it.each([
    ['reserved field name', 'id:text', 'reserved'],
    ['reserved platform column', 'updatedAt:date', 'reserved'],
    ['non-camelCase name', 'Name:text', 'Invalid field name'],
    ['kebab name', 'foo-bar:text', 'Invalid field name'],
    ['unknown type', 'foo:magic', 'Unknown field type "magic"'],
    ['select without options', 'status:select', 'needs options'],
    ['select with empty options', 'status:select()', 'needs options'],
    ['malformed select', 'status:select(', 'Malformed type'],
    ['invalid option charset', 'status:select(Open|closed)', 'Invalid option "Open"'],
    ['duplicate options', 'status:select(open|open)', 'Duplicate option "open"'],
    ['duplicate fields', 'name:text,name:text', 'Duplicate field name "name"'],
    ['unknown modifier', 'name:text:optional', 'Unknown field modifier'],
    ['options on non-select', 'name:text(a|b)', 'does not take options'],
    ['empty declaration', 'name:text,,notes:textarea', 'Empty field declaration'],
  ])('rejects %s and prints the grammar', async (_label, fields, expectedMessage) => {
    const root = tmpRoot()
    const run = await runScaffold(root, base(fields))
    expect(run.code).toBe(1)
    expect(run.output).toContain(expectedMessage)
    expect(run.output).toContain('--fields grammar:')
    expect(fs.existsSync(path.join(root, 'apps', 'mercato', 'src', 'modules', 'tickets'))).toBe(false)
  })

  it('rejects invalid module ids, entities, targets and reserved --no-ui', async () => {
    const root = tmpRoot()

    const badModule = await runScaffold(root, ['Tickets', '--entity', 'ticket', '--fields', 'name:text'])
    expect(badModule.code).toBe(1)
    expect(badModule.output).toContain('Invalid module id')

    const badEntity = await runScaffold(root, ['tickets', '--entity', 'Ticket', '--fields', 'name:text'])
    expect(badEntity.code).toBe(1)
    expect(badEntity.output).toContain('Invalid entity name')

    const missingEntity = await runScaffold(root, ['tickets', '--fields', 'name:text'])
    expect(missingEntity.code).toBe(1)
    expect(missingEntity.output).toContain('Missing --entity')

    const missingFields = await runScaffold(root, ['tickets', '--entity', 'ticket'])
    expect(missingFields.code).toBe(1)
    expect(missingFields.output).toContain('Missing --fields')

    const badTarget = await runScaffold(root, [
      'tickets', '--entity', 'ticket', '--fields', 'name:text', '--target', 'packages/ui',
    ])
    expect(badTarget.code).toBe(1)
    expect(badTarget.output).toContain('Unknown --target')

    const noUi = await runScaffold(root, ['tickets', '--entity', 'ticket', '--fields', 'name:text', '--no-ui'])
    expect(noUi.code).toBe(1)
    expect(noUi.output).toContain('reserved')
  })

  it('parseFieldsSpec throws FieldDslError with actionable messages', () => {
    expect(() => parseFieldsSpec('')).toThrow(FieldDslError)
    expect(() => parseFieldsSpec('tenantId:text')).toThrow(/reserved/)
    expect(() => parseFieldsSpec('a:select(x|)')).toThrow(/Invalid option/)
    expect(parseFieldsSpec('subject:text:required,status:select(open|closed),notes:textarea')).toEqual([
      { name: 'subject', type: 'text', required: true },
      { name: 'status', type: 'select', required: false, options: ['open', 'closed'] },
      { name: 'notes', type: 'textarea', required: false },
    ])
  })
})
