import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(currentDirectory, '..', '..', '..', '..')
const rootLayoutPaths = [
  path.join(repositoryRoot, 'apps', 'mercato', 'src', 'app', 'layout.tsx'),
  path.join(repositoryRoot, 'packages', 'create-app', 'template', 'src', 'app', 'layout.tsx'),
]

test('root layouts use a pre-interactive Next.js script for theme initialization', () => {
  for (const rootLayoutPath of rootLayoutPaths) {
    const source = fs.readFileSync(rootLayoutPath, 'utf8')

    assert.match(source, /import Script from ['"]next\/script['"]/, rootLayoutPath)
    assert.doesNotMatch(source, /<script(?:\s|>)/, rootLayoutPath)
    assert.match(
      source,
      /<Script\s+id="om-theme-init"\s+strategy="beforeInteractive">/,
      rootLayoutPath,
    )
    assert.match(source, /localStorage\.getItem\(['"]om-theme['"]\)/, rootLayoutPath)
  }
})
