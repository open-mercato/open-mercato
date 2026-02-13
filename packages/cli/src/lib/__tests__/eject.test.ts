import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { parseModuleMetadata, copyDirRecursive, updateModulesTs } from '../eject'

describe('eject', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eject-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('parseModuleMetadata', () => {
    it('returns empty object for missing file', () => {
      expect(parseModuleMetadata('/nonexistent/index.ts')).toEqual({})
    })

    it('parses ejectable: true', () => {
      const filePath = path.join(tmpDir, 'index.ts')
      fs.writeFileSync(filePath, `export const metadata = { ejectable: true }`)
      expect(parseModuleMetadata(filePath)).toMatchObject({ ejectable: true })
    })

    it('parses ejectable: false', () => {
      const filePath = path.join(tmpDir, 'index.ts')
      fs.writeFileSync(filePath, `export const metadata = { ejectable: false }`)
      expect(parseModuleMetadata(filePath)).toMatchObject({ ejectable: false })
    })

    it('parses title and description', () => {
      const filePath = path.join(tmpDir, 'index.ts')
      fs.writeFileSync(
        filePath,
        `export const metadata = { title: 'Currencies', description: 'Currency management', ejectable: true }`,
      )
      const result = parseModuleMetadata(filePath)
      expect(result).toEqual({
        ejectable: true,
        title: 'Currencies',
        description: 'Currency management',
      })
    })

    it('returns empty object when no metadata fields present', () => {
      const filePath = path.join(tmpDir, 'index.ts')
      fs.writeFileSync(filePath, `export const foo = 42`)
      expect(parseModuleMetadata(filePath)).toEqual({})
    })
  })

  describe('copyDirRecursive', () => {
    it('copies files and directories', () => {
      const src = path.join(tmpDir, 'src')
      const dest = path.join(tmpDir, 'dest')
      fs.mkdirSync(path.join(src, 'sub'), { recursive: true })
      fs.writeFileSync(path.join(src, 'a.ts'), 'export const a = 1')
      fs.writeFileSync(path.join(src, 'sub', 'b.ts'), 'export const b = 2')

      copyDirRecursive(src, dest)

      expect(fs.readFileSync(path.join(dest, 'a.ts'), 'utf8')).toBe('export const a = 1')
      expect(fs.readFileSync(path.join(dest, 'sub', 'b.ts'), 'utf8')).toBe('export const b = 2')
    })

    it('skips __tests__, __mocks__, and node_modules directories', () => {
      const src = path.join(tmpDir, 'src')
      const dest = path.join(tmpDir, 'dest')
      fs.mkdirSync(path.join(src, '__tests__'), { recursive: true })
      fs.mkdirSync(path.join(src, '__mocks__'), { recursive: true })
      fs.mkdirSync(path.join(src, 'node_modules'), { recursive: true })
      fs.writeFileSync(path.join(src, '__tests__', 'test.ts'), 'test')
      fs.writeFileSync(path.join(src, '__mocks__', 'mock.ts'), 'mock')
      fs.writeFileSync(path.join(src, 'node_modules', 'dep.js'), 'dep')
      fs.writeFileSync(path.join(src, 'keep.ts'), 'keep')

      copyDirRecursive(src, dest)

      expect(fs.existsSync(path.join(dest, '__tests__'))).toBe(false)
      expect(fs.existsSync(path.join(dest, '__mocks__'))).toBe(false)
      expect(fs.existsSync(path.join(dest, 'node_modules'))).toBe(false)
      expect(fs.existsSync(path.join(dest, 'keep.ts'))).toBe(true)
    })
  })

  describe('updateModulesTs', () => {
    it('replaces single-quoted from value with @app', () => {
      const filePath = path.join(tmpDir, 'modules.ts')
      fs.writeFileSync(
        filePath,
        `export const enabledModules = [\n  { id: 'currencies', from: '@open-mercato/core' },\n]`,
      )

      updateModulesTs(filePath, 'currencies')

      const result = fs.readFileSync(filePath, 'utf8')
      expect(result).toContain("{ id: 'currencies', from: '@app' }")
    })

    it('replaces double-quoted from value with @app', () => {
      const filePath = path.join(tmpDir, 'modules.ts')
      fs.writeFileSync(
        filePath,
        `export const enabledModules = [\n  { id: "currencies", from: "@open-mercato/core" },\n]`,
      )

      updateModulesTs(filePath, 'currencies')

      const result = fs.readFileSync(filePath, 'utf8')
      expect(result).toContain('{ id: "currencies", from: "@app" }')
    })

    it('inserts from: @app when entry has no from field', () => {
      const filePath = path.join(tmpDir, 'modules.ts')
      fs.writeFileSync(
        filePath,
        `export const enabledModules = [\n  { id: 'currencies' },\n]`,
      )

      updateModulesTs(filePath, 'currencies')

      const result = fs.readFileSync(filePath, 'utf8')
      expect(result).toContain("from: '@app'")
      expect(result).toContain("id: 'currencies'")
    })

    it('does not modify other modules', () => {
      const filePath = path.join(tmpDir, 'modules.ts')
      fs.writeFileSync(
        filePath,
        [
          `export const enabledModules = [`,
          `  { id: 'auth', from: '@open-mercato/core' },`,
          `  { id: 'currencies', from: '@open-mercato/core' },`,
          `  { id: 'catalog', from: '@open-mercato/core' },`,
          `]`,
        ].join('\n'),
      )

      updateModulesTs(filePath, 'currencies')

      const result = fs.readFileSync(filePath, 'utf8')
      expect(result).toContain("{ id: 'auth', from: '@open-mercato/core' }")
      expect(result).toContain("{ id: 'currencies', from: '@app' }")
      expect(result).toContain("{ id: 'catalog', from: '@open-mercato/core' }")
    })

    it('throws when modules.ts does not exist', () => {
      expect(() => updateModulesTs('/nonexistent/modules.ts', 'currencies')).toThrow(
        'modules.ts not found',
      )
    })

    it('throws when module entry is not found', () => {
      const filePath = path.join(tmpDir, 'modules.ts')
      fs.writeFileSync(
        filePath,
        `export const enabledModules = [\n  { id: 'auth', from: '@open-mercato/core' },\n]`,
      )

      expect(() => updateModulesTs(filePath, 'currencies')).toThrow(
        'Could not find module entry for "currencies"',
      )
    })
  })
})
