import * as fs from 'fs'
import * as path from 'path'

const packageRoot = path.resolve(__dirname, '../../..')
const srcRoot = path.join(packageRoot, 'src')

const collectSourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : collectSourceFiles(fullPath)
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [fullPath] : []
  })

describe('next/dynamic import specifier (#7102)', () => {
  it('imports the exact next/dynamic specifier so the Next compiler transform still applies', () => {
    const offenders = collectSourceFiles(srcRoot)
      .filter((file) => /from\s+['"]next\/dynamic\.js['"]/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(packageRoot, file))
    expect(offenders).toEqual([])
  })
})
