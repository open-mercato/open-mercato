import * as fs from 'fs'
import * as path from 'path'
import { execFileSync } from 'child_process'

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
  it('uses the explicit next/dynamic.js specifier so the dist loads under Node ESM', () => {
    const offenders = collectSourceFiles(srcRoot)
      .filter((file) => /from\s+['"]next\/dynamic['"]/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(packageRoot, file))
    expect(offenders).toEqual([])
  })

  it('resolves next/dynamic.js through the Node ESM resolver', () => {
    const output = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', "const mod = await import('next/dynamic.js'); console.log(typeof mod.default)"],
      { cwd: packageRoot, encoding: 'utf8' },
    )
    expect(output.trim()).toBe('function')
  })
})
