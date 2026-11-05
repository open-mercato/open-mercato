import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { toImportableModuleSpecifier } from '../commands'

describe('toImportableModuleSpecifier (#6238)', () => {
  it('converts cwd-relative node_modules migration paths to file: URLs', () => {
    const relative = path.join('node_modules', '@open-mercato', 'core', 'dist', 'modules', 'customers', 'migrations', 'Migration20250101000000.js')
    const result = toImportableModuleSpecifier(relative)

    expect(result.startsWith('file:')).toBe(true)
    expect(result).toBe(pathToFileURL(path.resolve(relative)).href)
  })

  it('converts absolute filesystem paths to file: URLs on every platform', () => {
    const absolute = path.resolve('migrations', 'Migration20250101000000.js')
    expect(toImportableModuleSpecifier(absolute)).toBe(pathToFileURL(absolute).href)
  })

  it('converts ./ and ../ relative paths to file: URLs', () => {
    expect(toImportableModuleSpecifier('./Migration.js')).toBe(pathToFileURL(path.resolve('./Migration.js')).href)
    expect(toImportableModuleSpecifier('../migrations/Migration.js')).toBe(
      pathToFileURL(path.resolve('../migrations/Migration.js')).href,
    )
  })

  it('leaves bare package names and package subpaths alone', () => {
    expect(toImportableModuleSpecifier('zod')).toBe('zod')
    expect(toImportableModuleSpecifier('@mikro-orm/core')).toBe('@mikro-orm/core')
    expect(toImportableModuleSpecifier('next/server')).toBe('next/server')
  })

  it('leaves existing file: and node: URLs alone', () => {
    expect(toImportableModuleSpecifier('file:///tmp/Migration.js')).toBe('file:///tmp/Migration.js')
    expect(toImportableModuleSpecifier('node:fs')).toBe('node:fs')
  })
})
