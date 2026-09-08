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

test('root layouts render the shared theme initializer as a render-blocking inline script', () => {
  for (const rootLayoutPath of rootLayoutPaths) {
    const source = fs.readFileSync(rootLayoutPath, 'utf8')

    assert.match(
      source,
      /import \{ THEME_INIT_SCRIPT \} from ['"]@open-mercato\/ui\/theme\/theme-init-script['"]/,
      rootLayoutPath,
    )
    assert.match(
      source,
      /<script\s+id="om-theme-init"[\s\S]*?dangerouslySetInnerHTML=\{\{ __html: THEME_INIT_SCRIPT \}\}/,
      rootLayoutPath,
    )
  }
})

test('root layouts never defer the theme initializer past first paint', () => {
  for (const rootLayoutPath of rootLayoutPaths) {
    const source = fs.readFileSync(rootLayoutPath, 'utf8')

    assert.equal(source.includes('next/script'), false, rootLayoutPath)
    assert.equal(source.includes('beforeInteractive'), false, rootLayoutPath)
    assert.equal(source.includes('<Script'), false, rootLayoutPath)
  }
})

test('root layouts run the theme initializer before the application tree', () => {
  for (const rootLayoutPath of rootLayoutPaths) {
    const source = fs.readFileSync(rootLayoutPath, 'utf8')

    const bodyIndex = source.indexOf('<body')
    const scriptIndex = source.indexOf('id="om-theme-init"')
    const providersIndex = source.indexOf('<AppProviders')

    assert.ok(bodyIndex >= 0 && scriptIndex >= 0 && providersIndex >= 0, rootLayoutPath)
    assert.ok(scriptIndex > bodyIndex, rootLayoutPath)
    assert.ok(scriptIndex < providersIndex, rootLayoutPath)
  }
})

test('the shared theme initializer keeps the documented storage key and dark class contract', () => {
  const themeScriptPath = path.join(
    repositoryRoot,
    'packages',
    'ui',
    'src',
    'theme',
    'theme-init-script.ts',
  )
  const source = fs.readFileSync(themeScriptPath, 'utf8')

  assert.match(source, /export const THEME_STORAGE_KEY = 'om-theme'/)
  assert.match(source, /localStorage\.getItem\(/)
  assert.match(source, /prefers-color-scheme: dark/)
  assert.match(source, /classList\.add\('dark'\)/)
})
