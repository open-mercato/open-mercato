import { fontSourceLocation, isAbsolutePath, isNpmPackageName, isRelativePathInsidePackage, isWoff2Font } from '../fontSources'

describe('font source helpers', () => {
  it('recognises absolute POSIX and Windows paths', () => {
    expect(isAbsolutePath('/app/public/fonts/Brand.ttf')).toBe(true)
    expect(isAbsolutePath('C:\\fonts\\Brand.ttf')).toBe(true)
    expect(isAbsolutePath('D:/fonts/Brand.ttf')).toBe(true)
    expect(isAbsolutePath('\\\\server\\fonts\\Brand.ttf')).toBe(true)
    expect(isAbsolutePath('fonts/Brand.ttf')).toBe(false)
  })

  it('accepts only relative paths that stay inside the package', () => {
    expect(isRelativePathInsidePackage('files/inter-latin-400-normal.woff')).toBe(true)
    expect(isRelativePathInsidePackage('../secret.ttf')).toBe(false)
    expect(isRelativePathInsidePackage('files\\..\\secret.ttf')).toBe(false)
    expect(isRelativePathInsidePackage('/etc/fonts/Brand.ttf')).toBe(false)
  })

  it('accepts npm package names only', () => {
    expect(isNpmPackageName('@fontsource/inter')).toBe(true)
    expect(isNpmPackageName('pdfjs-dist')).toBe(true)
    expect(isNpmPackageName('../../etc')).toBe(false)
    expect(isNpmPackageName('Font Pack')).toBe(false)
    expect(isNpmPackageName('@scope/../x')).toBe(false)
  })

  it('detects WOFF2 files by extension, ignoring case, query and hash', () => {
    expect(isWoff2Font('files/inter.woff2')).toBe(true)
    expect(isWoff2Font('https://cdn.example.test/Brand.WOFF2?v=1')).toBe(true)
    expect(isWoff2Font('Brand.woff2#font')).toBe(true)
    expect(isWoff2Font('files/inter.woff')).toBe(false)
  })

  it('returns the location of each source kind', () => {
    expect(fontSourceLocation({ url: 'https://cdn.example.test/a.ttf' })).toBe('https://cdn.example.test/a.ttf')
    expect(fontSourceLocation({ path: '/fonts/a.ttf' })).toBe('/fonts/a.ttf')
    expect(fontSourceLocation({ file: 'files/a.ttf' })).toBe('files/a.ttf')
  })
})
