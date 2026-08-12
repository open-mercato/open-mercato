import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const packageSource = resolve(__dirname, '../../../document-generators/src')

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? listSourceFiles(path) : [path]
  })
}

describe('document-generators domain boundary', () => {
  it('contains no Sales entity resolution, resource kinds, or domain directories', () => {
    const files = listSourceFiles(packageSource)
    const source = files
      .filter((path) => /\.(ts|tsx)$/.test(path))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')

    expect(source).not.toMatch(/resolve\(['"]Sales/)
    expect(source).not.toMatch(/resourceKind:\s*['"]sales\./)
    expect(files.some((path) => /\/(sales|orders|quotes)(\/|$)/.test(path))).toBe(false)
  })
})
