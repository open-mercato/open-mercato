import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const tsconfigPath = fileURLToPath(new URL('../../template/tsconfig.json', import.meta.url))
const homePagePath = fileURLToPath(new URL('../../template/src/app/page.tsx', import.meta.url))
const monorepoAppTsconfigPath = fileURLToPath(new URL('../../../../apps/mercato/tsconfig.json', import.meta.url))

function readExcludes(filePath: string): string[] {
  const tsconfig = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { exclude?: string[] }
  return tsconfig.exclude ?? []
}

test('standalone template excludes sandboxed agent scripts and tools from the TypeScript program', () => {
  const excludes = readExcludes(tsconfigPath)

  assert.ok(excludes.includes('src/modules/**/agents/**/scripts/**'))
  assert.ok(excludes.includes('src/modules/**/agents/**/tools/**'))
})

test('standalone template mirrors every agent sandbox exclude of the monorepo app tsconfig', () => {
  const templateExcludes = readExcludes(tsconfigPath)
  const agentExcludes = readExcludes(monorepoAppTsconfigPath).filter((pattern) => pattern.includes('/agents/'))

  assert.ok(agentExcludes.length > 0)
  for (const pattern of agentExcludes) {
    assert.ok(templateExcludes.includes(pattern), `template tsconfig.json is missing exclude "${pattern}"`)
  }
})

test('standalone template path aliases do not use the TypeScript 6 deprecated baseUrl option', () => {
  const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8')) as {
    compilerOptions: { baseUrl?: string; paths?: Record<string, string[]> }
  }

  assert.equal('baseUrl' in tsconfig.compilerOptions, false)
  assert.deepEqual(tsconfig.compilerOptions.paths?.['@/*'], ['./src/*'])
})

test('standalone application typecheck excludes executable agent snippets', () => {
  const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8')) as { exclude?: string[] }
  assert.ok(tsconfig.exclude?.includes('src/modules/**/agents/**/scripts/**'))
  assert.ok(tsconfig.exclude?.includes('src/modules/**/agents/**/tools/**'))
})

test('standalone home page does not import an autologin subpath ahead of its dependency version', () => {
  const source = fs.readFileSync(homePagePath, 'utf8')

  assert.doesNotMatch(source, /@open-mercato\/core\/modules\/auth\/lib\/autologin/)
  assert.match(source, /function isAutoLoginEnabled\(\): boolean/)
  assert.match(source, /!auth && isAutoLoginEnabled\(\)/)
  assert.match(source, /process\.env\.OM_AUTOLOGIN_EMAIL\?\.trim\(\)/)
  assert.match(source, /process\.env\.OM_AUTOLOGIN_PASSWORD/)
})
