import fs from 'node:fs'
import path from 'node:path'

describe('gateway-stripe server SDK loading', () => {
  function collectTypeScriptFiles(directory: string): string[] {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) return collectTypeScriptFiles(entryPath)
      return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : []
    })
  }

  it('does not statically import the Stripe server SDK', () => {
    const runtimeImport = /^\s*import\s+(?!type\b)(?:[^'"]+\sfrom\s+)?['"]stripe['"]/m
    const serverFiles = collectTypeScriptFiles(path.resolve(__dirname, '../lib'))

    for (const filePath of serverFiles) {
      const source = fs.readFileSync(filePath, 'utf8')
      expect(source).not.toMatch(runtimeImport)
    }
  })

  it('loads the Stripe server SDK dynamically from the centralized client helper', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../lib/client.ts'), 'utf8')
    expect(source).toMatch(/import\(['"]stripe['"]\)/)
  })
})
