import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      return entry.name === '__tests__' || entry.name === '__integration__' ? [] : sourceFiles(path)
    }
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

describe('Documents platform import boundary', () => {
  it('uses public DI seams instead of Auth, Directory, or API Keys implementations', () => {
    const packageRoot = resolve(__dirname, '../../../..')
    const files = [
      ...sourceFiles(join(packageRoot, 'src')),
      ...sourceFiles(join(packageRoot, 'server')),
    ]
    const violations = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return /@open-mercato\/core\/modules\/(?:auth|directory|api_keys)(?:\/|['"])/.test(source)
        ? [file.slice(packageRoot.length + 1)]
        : []
    })
    expect(violations).toEqual([])
  })
})
