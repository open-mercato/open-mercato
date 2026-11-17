import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import ts from 'typescript-standalone'
import { ensureModuleRegistration } from '@open-mercato/cli/lib/modules-config'
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


test('app and scaffold ModuleEntry types accept emitted module origin registration', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-module-entry-types-'))
  const moduleSources = [
    new URL('../../../../apps/mercato/src/modules.ts', import.meta.url),
    new URL('../../template/src/modules.ts', import.meta.url),
    new URL('./templates/modules-ts.template', import.meta.url),
  ]
  try {
    for (const [sourceIndex, sourceUrl] of moduleSources.entries()) {
      const source = fs.readFileSync(sourceUrl, 'utf8')
      const parsed = ts.createSourceFile('modules.ts', source, ts.ScriptTarget.Latest, true)
      const entryType = parsed.statements.find((statement): statement is ts.TypeAliasDeclaration =>
        ts.isTypeAliasDeclaration(statement) && statement.name.text === 'ModuleEntry',
      )
      assert.ok(entryType, `ModuleEntry missing in ${fileURLToPath(sourceUrl)}`)
      const fixturePath = path.join(fixtureRoot, `modules-${sourceIndex}.ts`)
      fs.writeFileSync(fixturePath, [
        'type ModuleOverrides = Record<string, unknown>',
        entryType.getText(parsed),
        "export const enabledModules: ModuleEntry[] = [{ id: 'customers', from: '@open-mercato/core' }]",
        '',
      ].join('\n'))
      ensureModuleRegistration(fixturePath, {
        id: 'marketing_consents',
        from: '@app',
        locator: 'github:pkarw/marketing-consents',
        packageName: '@pkarw/marketing_consents',
      })
    }
    fs.writeFileSync(path.join(fixtureRoot, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, types: [], target: 'ES2022', skipLibCheck: true },
      include: ['*.ts'],
    }))
    const require = createRequire(import.meta.url)
    execFileSync(process.execPath, [require.resolve('typescript-standalone/bin/tsc'), '--project', fixtureRoot], {
      encoding: 'utf8',
      stdio: 'pipe',
    })
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  }
})
