import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { preferredFontFamilyName, resolveFontFamily } from '../font-sources'
import type { FontSourceConfig } from '../../data/validators'

let appRoot: string

beforeAll(() => {
  appRoot = realpathSync(mkdtempSync(path.join(tmpdir(), 'om-font-sources-')))
  writeFileSync(path.join(appRoot, 'package.json'), '{"name":"app"}')
  const fontDirectory = path.join(appRoot, 'node_modules', '@fontsource', 'inter', 'files')
  mkdirSync(fontDirectory, { recursive: true })
  writeFileSync(path.join(fontDirectory, 'inter-latin-ext-400-normal.woff'), 'font')
  writeFileSync(path.join(appRoot, 'Brand.ttf'), 'font')
})

afterAll(() => rmSync(appRoot, { recursive: true, force: true }))

describe('resolveFontFamily source lookup', () => {
  const resolveOne = (source: FontSourceConfig) =>
    resolveFontFamily({ family: 'Font', sources: [source] }, { appRoot }).fonts[0].src

  it('finds a package file in the application node_modules', () => {
    expect(resolveOne({ package: '@fontsource/inter', file: 'files/inter-latin-ext-400-normal.woff' }))
      .toBe(path.join(appRoot, 'node_modules', '@fontsource', 'inter', 'files', 'inter-latin-ext-400-normal.woff'))
  })

  it('names the package and file when the package is not installed', () => {
    expect(() => resolveOne({ package: '@fontsource/missing', file: 'files/a.woff' }))
      .toThrow('Font file "files/a.woff" not found in package "@fontsource/missing"')
  })

  it('accepts an existing absolute path and passes URLs through', () => {
    const brand = path.join(appRoot, 'Brand.ttf')
    expect(resolveOne({ path: brand })).toBe(brand)
    expect(() => resolveOne({ path: path.join(appRoot, 'Missing.ttf') })).toThrow('Font file not found')
    expect(resolveOne({ url: 'https://cdn.example.test/Brand.ttf' })).toBe('https://cdn.example.test/Brand.ttf')
  })
})

describe('resolveFontFamily', () => {
  it('resolves every source of the family with its weight and style', () => {
    const font = resolveFontFamily({
      family: 'Brand',
      sources: [
        { package: '@fontsource/inter', file: 'files/inter-latin-ext-400-normal.woff', fontWeight: 400 },
        { path: path.join(appRoot, 'Brand.ttf'), fontWeight: 700, fontStyle: 'italic' },
      ],
    }, { appRoot })
    expect(font).toEqual({
      family: 'Brand',
      fonts: [
        { src: path.join(appRoot, 'node_modules', '@fontsource', 'inter', 'files', 'inter-latin-ext-400-normal.woff'), fontWeight: 400 },
        { src: path.join(appRoot, 'Brand.ttf'), fontWeight: 700, fontStyle: 'italic' },
      ],
    })
  })
})

describe('preferredFontFamilyName', () => {
  const families = (names: string[]) => names.map((name) => ({ family: name, sources: [{ url: `https://cdn.example.test/${name}.ttf` }] }))

  it('prefers an explicit fontFamily, then the registered families, else leaves it to the renderer', () => {
    expect(preferredFontFamilyName({ fontFamily: 'Times-Roman', fonts: families(['Inter']) })).toBe('Times-Roman')
    expect(preferredFontFamilyName({ fonts: families(['Inter', 'Inter Latin Ext']) })).toEqual(['Inter', 'Inter Latin Ext'])
    expect(preferredFontFamilyName({ fonts: [] })).toBeUndefined()
  })
})
