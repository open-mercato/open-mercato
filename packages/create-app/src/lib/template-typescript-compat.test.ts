import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const tsconfigPath = fileURLToPath(new URL('../../template/tsconfig.json', import.meta.url))
const homePagePath = fileURLToPath(new URL('../../template/src/app/page.tsx', import.meta.url))

test('standalone template path aliases do not use the TypeScript 6 deprecated baseUrl option', () => {
  const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8')) as {
    compilerOptions: { baseUrl?: string; paths?: Record<string, string[]> }
  }

  assert.equal('baseUrl' in tsconfig.compilerOptions, false)
  assert.deepEqual(tsconfig.compilerOptions.paths?.['@/*'], ['./src/*'])
})

test('standalone home page does not import an autologin subpath ahead of its dependency version', () => {
  const source = fs.readFileSync(homePagePath, 'utf8')

  assert.doesNotMatch(source, /@open-mercato\/core\/modules\/auth\/lib\/autologin/)
  assert.match(source, /process\.env\.OM_AUTOLOGIN_EMAIL\?\.trim\(\)/)
  assert.match(source, /process\.env\.OM_AUTOLOGIN_PASSWORD/)
})
