/**
 * Warnings for module conventions that otherwise fail silently.
 *
 * Each case below corresponds to a convention where getting the name wrong produces a
 * generator run that succeeds, a manifest that looks correct, and a defect that only
 * appears at runtime. The `does not warn` half of each pair matters as much as the
 * warning half: a diagnostic that fires on correct code is noise, and noise gets muted.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  warnIfPageMetaMissingMetadataExport,
  warnIfRegisterCommandNotAtImportTime,
} from '../module-registry'
import { warnIfDiMissingRegisterExport } from '../module-di'

let tmpDir: string
let warnSpy: jest.SpyInstance

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-warn-'))
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  warnSpy.mockRestore()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function write(name: string, contents: string): string {
  const file = path.join(tmpDir, name)
  fs.writeFileSync(file, contents, 'utf8')
  return file
}

function warnings(): string {
  return warnSpy.mock.calls.map((call) => String(call[0])).join('\n')
}

describe('page.meta metadata export', () => {
  it('warns, and names the lost authorization gate, when the export is not `metadata`', () => {
    const file = write('page.meta.ts', `export const meta = { requireAuth: true, requireFeatures: ['x.view'] }\nexport default meta\n`)
    warnIfPageMetaMissingMetadataExport(file)
    // The consequence is the point: an author who mistypes the name has no way to discover
    // that the page lost `requireAuth` unless the message says so.
    expect(warnings()).toContain('requireAuth')
    expect(warnings()).toContain(file)
  })

  it('does not warn when `metadata` is exported', () => {
    const file = write('page.meta.ts', `export const metadata = { requireAuth: true }\nexport default metadata\n`)
    warnIfPageMetaMissingMetadataExport(file)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('does not warn when no metadata file was discovered', () => {
    warnIfPageMetaMissingMetadataExport(null)
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

describe('registerCommand reachability', () => {
  it('warns when every registerCommand call sits inside an uncalled function', () => {
    const file = write('books.ts', [
      `import { registerCommand } from '@open-mercato/shared/lib/commands'`,
      `const createBook = { id: 'library.books.create' }`,
      `export function registerLibraryBookCommands() {`,
      `  registerCommand(createBook)`,
      `}`,
    ].join('\n'))
    warnIfRegisterCommandNotAtImportTime(file)
    expect(warnings()).toContain('will not register at runtime')
  })

  it('does not warn when registerCommand runs at import time', () => {
    const file = write('books.ts', [
      `import { registerCommand } from '@open-mercato/shared/lib/commands'`,
      `const createBook = { id: 'library.books.create' }`,
      `registerCommand(createBook)`,
    ].join('\n'))
    warnIfRegisterCommandNotAtImportTime(file)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('does not warn for a helper file that registers nothing', () => {
    const file = write('shared-helpers.ts', `export function ensureScope() { return null }\n`)
    warnIfRegisterCommandNotAtImportTime(file)
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

describe('di register export', () => {
  it('warns when di.ts exports no `register`', () => {
    const file = write('di.ts', `export function setupLibraryDi(container: unknown) { void container }\n`)
    warnIfDiMissingRegisterExport(file)
    expect(warnings()).toContain('DI registrations will never run')
  })

  it.each([
    ['function declaration', `export function register(container: unknown) { void container }\n`],
    ['async function', `export async function register(container: unknown) { void container }\n`],
    ['const arrow', `export const register = (container: unknown) => { void container }\n`],
    ['named re-export', `function register() {}\nexport { register }\n`],
  ])('does not warn for a %s', (_label, source) => {
    const file = write('di.ts', source)
    warnIfDiMissingRegisterExport(file)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('stays silent when quiet is set', () => {
    const file = write('di.ts', `export function nope() {}\n`)
    warnIfDiMissingRegisterExport(file, true)
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
