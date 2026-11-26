import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  BLOCK_CONTRACTS_IMPORT,
  hashContent,
  listBlockIds,
  listImportSpecifiers,
  readBlockSource,
  transformBlockFile,
} from '../ui-blocks-source'
import { addBlock, createUnifiedDiff, diffBlock, readBlocksLock } from '../ui-blocks'
import { parseUiCommandArgs, runUiCommand } from '../ui-blocks-command'

const realUiRoot = path.resolve(__dirname, '../../../../ui')

const COMPONENT_SOURCE = [
  "import * as React from 'react'",
  "import { Button } from '@open-mercato/ui/primitives/button'",
  "import type { SampleProps } from '../contracts/sample'",
  "import { describeSample } from './helpers'",
  '',
  'export function Sample({ label }: SampleProps) {',
  '  return <Button>{describeSample(label)}</Button>',
  '}',
  '',
].join('\n')

const INDEX_SOURCE = [
  "export { Sample } from './Sample'",
  "export type { SampleProps } from '../contracts/sample'",
  "export { sampleFixtures } from './fixtures'",
  "export type { SampleFixtureName } from './fixtures'",
  '',
].join('\n')

function writeFile(root: string, relativePath: string, content: string): void {
  const target = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

function createUiPackage(root: string, version: string): void {
  writeFile(root, 'package.json', JSON.stringify({ name: '@open-mercato/ui', version }))
  writeFile(root, 'src/blocks/contracts/sample.ts', 'export type SampleProps = { label: string }\n')
  writeFile(root, 'src/blocks/sample/Sample.tsx', COMPONENT_SOURCE)
  writeFile(root, 'src/blocks/sample/helpers.ts', 'export const describeSample = (label: string) => label\n')
  writeFile(root, 'src/blocks/sample/index.ts', INDEX_SOURCE)
  writeFile(root, 'src/blocks/sample/fixtures.ts', 'export const sampleFixtures = {}\n')
  writeFile(root, 'src/blocks/sample/__tests__/Sample.test.tsx', 'export {}\n')
  writeFile(root, 'src/blocks/inventory/portability.ts', 'export {}\n')
}

describe('ui blocks', () => {
  let tmpDir: string
  let uiRoot: string
  let appDir: string
  let moduleDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-blocks-test-'))
    uiRoot = path.join(tmpDir, 'node_modules', '@open-mercato', 'ui')
    appDir = path.join(tmpDir, 'app')
    moduleDir = path.join(appDir, 'src', 'modules', 'service_orders')
    createUiPackage(uiRoot, '1.0.0')
    fs.mkdirSync(moduleDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const context = () => ({ appDir, uiPackageRoot: uiRoot })
  const targetFile = (name: string) => path.join(moduleDir, 'components', 'blocks', 'sample', name)

  describe('source', () => {
    it('lists block folders and skips contracts, inventory and tests', () => {
      expect(listBlockIds(uiRoot)).toEqual(['sample'])
    })

    it('leaves out fixtures and tests, and points contract imports at the package', () => {
      const source = readBlockSource(uiRoot, 'sample')
      expect(source.files.map((file) => file.path)).toEqual(['Sample.tsx', 'helpers.ts', 'index.ts'])
      const component = source.files.find((file) => file.path === 'Sample.tsx')?.content ?? ''
      expect(component).toContain(`import type { SampleProps } from '${BLOCK_CONTRACTS_IMPORT}'`)
      expect(component).toContain("from './helpers'")
      const index = source.files.find((file) => file.path === 'index.ts')?.content ?? ''
      expect(index).not.toContain('fixtures')
      expect(index).toContain(`export type { SampleProps } from '${BLOCK_CONTRACTS_IMPORT}'`)
    })

    it('fails when a block reaches outside its folder without a public path', () => {
      expect(() => transformBlockFile('sample', 'Sample.tsx', "import { x } from '../../backend/utils/x'\n")).toThrow(
        /outside the block/,
      )
    })

    it('rejects unknown block ids, including path traversal', () => {
      expect(() => readBlockSource(uiRoot, 'missing')).toThrow(/Unknown block "missing"/)
      expect(() => readBlockSource(uiRoot, '../contracts')).toThrow(/Unknown block/)
    })

    it('keeps the hash stable for unchanged sources and changes it with the content', () => {
      const first = readBlockSource(uiRoot, 'sample').hash
      expect(readBlockSource(uiRoot, 'sample').hash).toBe(first)
      writeFile(uiRoot, 'src/blocks/sample/helpers.ts', 'export const describeSample = (label: string) => label.trim()\n')
      expect(readBlockSource(uiRoot, 'sample').hash).not.toBe(first)
    })
  })

  describe('add', () => {
    it('copies the block into the module and records name, version and hashes in the lock', () => {
      const result = addBlock(context(), 'sample', 'service_orders')
      expect(result.action).toBe('installed')
      expect(result.written).toEqual(['Sample.tsx', 'helpers.ts', 'index.ts'])
      expect(fs.existsSync(targetFile('fixtures.ts'))).toBe(false)
      const source = readBlockSource(uiRoot, 'sample')
      expect(fs.readFileSync(targetFile('Sample.tsx'), 'utf8')).toBe(source.files[0].content)
      const lock = readBlocksLock(moduleDir)
      expect(lock).toEqual({
        version: 1,
        blocks: {
          sample: {
            package: '@open-mercato/ui',
            packageVersion: '1.0.0',
            hash: source.hash,
            target: 'components/blocks/sample',
            files: Object.fromEntries(source.files.map((file) => [file.path, file.hash])),
          },
        },
      })
    })

    it('is a no-op when the copy already matches the registry', () => {
      addBlock(context(), 'sample', 'service_orders')
      const lockBefore = fs.readFileSync(path.join(moduleDir, 'blocks.lock.json'), 'utf8')
      const result = addBlock(context(), 'sample', 'service_orders')
      expect(result.action).toBe('unchanged')
      expect(result.written).toEqual([])
      expect(fs.readFileSync(path.join(moduleDir, 'blocks.lock.json'), 'utf8')).toBe(lockBefore)
    })

    it('refuses to overwrite local edits without --force', () => {
      addBlock(context(), 'sample', 'service_orders')
      fs.appendFileSync(targetFile('Sample.tsx'), '// local change\n')
      expect(() => addBlock(context(), 'sample', 'service_orders')).toThrow(/has local changes: Sample\.tsx/)
      expect(fs.readFileSync(targetFile('Sample.tsx'), 'utf8')).toContain('// local change')
      const forced = addBlock(context(), 'sample', 'service_orders', { force: true })
      expect(forced.written).toEqual(['Sample.tsx'])
      expect(fs.readFileSync(targetFile('Sample.tsx'), 'utf8')).not.toContain('// local change')
    })

    it('treats deleted and added files as local edits', () => {
      addBlock(context(), 'sample', 'service_orders')
      fs.rmSync(targetFile('helpers.ts'))
      fs.writeFileSync(targetFile('extra.ts'), 'export {}\n')
      expect(() => addBlock(context(), 'sample', 'service_orders')).toThrow(/extra\.ts, helpers\.ts/)
    })

    it('refuses to adopt untracked files in the target folder', () => {
      fs.mkdirSync(path.dirname(targetFile('Sample.tsx')), { recursive: true })
      fs.writeFileSync(targetFile('Sample.tsx'), 'export {}\n')
      expect(() => addBlock(context(), 'sample', 'service_orders')).toThrow(/does not track/)
    })

    it('updates an untouched copy to a newer registry version and removes dropped files', () => {
      addBlock(context(), 'sample', 'service_orders')
      createUiPackage(uiRoot, '1.1.0')
      fs.rmSync(path.join(uiRoot, 'src/blocks/sample/helpers.ts'))
      writeFile(uiRoot, 'src/blocks/sample/Sample.tsx', "export function Sample() {\n  return null\n}\n")
      const result = addBlock(context(), 'sample', 'service_orders')
      expect(result.action).toBe('updated')
      expect(result.written).toEqual(['Sample.tsx'])
      expect(result.removed).toEqual(['helpers.ts'])
      expect(fs.existsSync(targetFile('helpers.ts'))).toBe(false)
      expect(readBlocksLock(moduleDir).blocks.sample.packageVersion).toBe('1.1.0')
    })

    it('keeps other blocks in the lock', () => {
      writeFile(uiRoot, 'src/blocks/other/index.ts', 'export const other = 1\n')
      addBlock(context(), 'sample', 'service_orders')
      addBlock(context(), 'other', 'service_orders')
      expect(Object.keys(readBlocksLock(moduleDir).blocks)).toEqual(['other', 'sample'])
    })

    it('only writes into existing app modules', () => {
      expect(() => addBlock(context(), 'sample', 'missing_module')).toThrow(/was not found/)
      expect(() => addBlock(context(), 'sample', '../outside')).toThrow(/Invalid module id/)
      expect(fs.existsSync(path.join(appDir, 'src', 'outside'))).toBe(false)
    })
  })

  describe('diff', () => {
    it('reports no differences for a fresh copy', () => {
      addBlock(context(), 'sample', 'service_orders')
      const result = diffBlock(context(), 'sample', 'service_orders')
      expect(result.files).toEqual([])
      expect(result.registryChanged).toBe(false)
      expect(result.localEdits).toEqual([])
    })

    it('shows local edits as a unified diff against the registry version', () => {
      addBlock(context(), 'sample', 'service_orders')
      const edited = fs.readFileSync(targetFile('helpers.ts'), 'utf8').replace('=> label', '=> label.toUpperCase()')
      fs.writeFileSync(targetFile('helpers.ts'), edited)
      const result = diffBlock(context(), 'sample', 'service_orders')
      expect(result.localEdits).toEqual(['helpers.ts'])
      expect(result.files).toHaveLength(1)
      expect(result.files[0]).toMatchObject({ path: 'helpers.ts', status: 'modified' })
      expect(result.files[0].patch).toContain('-export const describeSample = (label: string) => label')
      expect(result.files[0].patch).toContain('+export const describeSample = (label: string) => label.toUpperCase()')
    })

    it('flags a newer registry source for an untouched copy', () => {
      addBlock(context(), 'sample', 'service_orders')
      createUiPackage(uiRoot, '1.1.0')
      writeFile(uiRoot, 'src/blocks/sample/helpers.ts', 'export const describeSample = (label: string) => label.trim()\n')
      const result = diffBlock(context(), 'sample', 'service_orders')
      expect(result).toMatchObject({ lockedVersion: '1.0.0', registryVersion: '1.1.0', registryChanged: true, localEdits: [] })
      expect(result.files.map((file) => file.path)).toEqual(['helpers.ts'])
    })

    it('fails for a block that was never copied', () => {
      expect(() => diffBlock(context(), 'sample', 'service_orders')).toThrow(/is not installed/)
    })

    it('builds hunks with context and line numbers', () => {
      const before = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', ''].join('\n')
      const after = before.replace('five', 'FIVE')
      expect(createUnifiedDiff('file.ts', before, after)).toBe(
        ['--- registry/file.ts', '+++ local/file.ts', '@@ -2,7 +2,7 @@', ' two', ' three', ' four', '-five', '+FIVE', ' six', ' seven', ' eight', ''].join('\n'),
      )
      expect(createUnifiedDiff('file.ts', before, before)).toBe('')
    })
  })

  describe('command', () => {
    function runCommand(args: string[]) {
      const output: string[] = []
      const errors: string[] = []
      const code = runUiCommand(args, context(), { log: (line) => output.push(line), error: (line) => errors.push(line) })
      return { code, output: output.join('\n'), errors: errors.join('\n') }
    }

    it('parses module, flags and positionals', () => {
      expect(parseUiCommandArgs(['sample', '--module', 'service_orders', '--force'])).toMatchObject({
        positionals: ['sample'],
        moduleId: 'service_orders',
        force: true,
      })
      expect(parseUiCommandArgs(['--module=crm', '--json', '--exit-code'])).toMatchObject({ moduleId: 'crm', json: true, exitCode: true })
      expect(() => parseUiCommandArgs(['--nope'])).toThrow(/Unknown option/)
    })

    it('lists blocks as JSON for agents', () => {
      const { code, output } = runCommand(['list', '--json'])
      expect(code).toBe(0)
      expect(JSON.parse(output)).toEqual({
        version: 1,
        blocks: [
          {
            id: 'sample',
            package: '@open-mercato/ui',
            packageVersion: '1.0.0',
            hash: readBlockSource(uiRoot, 'sample').hash,
            files: ['Sample.tsx', 'helpers.ts', 'index.ts'],
          },
        ],
      })
    })

    it('requires a block and a module for add', () => {
      expect(runCommand(['add', 'sample']).code).toBe(1)
      expect(runCommand(['add', '--module', 'service_orders']).code).toBe(1)
    })

    it('adds a block and then diffs every copied block in the module', () => {
      expect(runCommand(['add', 'sample', '--module', 'service_orders']).output).toContain('installed in')
      expect(runCommand(['diff', '--module', 'service_orders', '--exit-code'])).toMatchObject({ code: 0 })
      fs.appendFileSync(targetFile('helpers.ts'), 'export const extra = 1\n')
      const diff = runCommand(['diff', '--module', 'service_orders', '--exit-code'])
      expect(diff.code).toBe(1)
      expect(diff.output).toContain('+export const extra = 1')
      expect(runCommand(['diff', '--module', 'service_orders']).code).toBe(0)
    })

    it('prints usage for help and unknown subcommands', () => {
      expect(runCommand([]).output).toContain('yarn mercato ui add <block> --module <moduleId>')
      expect(runCommand(['nope']).code).toBe(1)
    })
  })

  describe('shipped blocks', () => {
    const blockIds = listBlockIds(realUiRoot)

    it('finds the block families in @open-mercato/ui', () => {
      expect(blockIds).toEqual(expect.arrayContaining(['entity-header', 'kanban', 'key-value', 'stack', 'timeline', 'wizard']))
    })

    it.each(blockIds)('%s copies into a self-contained folder', (blockId) => {
      const source = readBlockSource(realUiRoot, blockId)
      const copied = new Set(source.files.map((file) => file.path))
      expect(copied.has('index.ts')).toBe(true)
      for (const file of source.files) {
        expect(file.hash).toBe(hashContent(file.content))
        for (const specifier of listImportSpecifiers(file.content)) {
          if (!specifier.startsWith('.')) continue
          const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file.path), specifier))
          const candidates = [resolved, `${resolved}.ts`, `${resolved}.tsx`, `${resolved}/index.ts`]
          expect({ file: file.path, specifier, resolves: candidates.some((candidate) => copied.has(candidate)) }).toEqual({
            file: file.path,
            specifier,
            resolves: true,
          })
        }
      }
    })
  })
})
