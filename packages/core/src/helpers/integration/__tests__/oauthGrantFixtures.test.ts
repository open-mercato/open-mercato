/** @jest-environment node */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import * as fakeAuthorizationServer from '../../../modules/integrations/lib/oauth/testing/fakeAuthorizationServer'
import * as oauthGrantFixtures from '../oauthGrantFixtures'

const SRC_ROOT = path.resolve(__dirname, '../../..')
const SHARED_SRC_ROOT = path.resolve(SRC_ROOT, '../../shared/src')
const FIXTURES_FILE = path.join(SRC_ROOT, 'helpers/integration/oauthGrantFixtures.ts')
const FAKE_SERVER_FILE = path.join(SRC_ROOT, 'modules/integrations/lib/oauth/testing/fakeAuthorizationServer.ts')

const PLAYWRIGHT_SPECIFIER = /^(?:@playwright\/test|playwright|playwright-core)(?:\/|$)/
const SPECIFIER_PATTERNS = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\s+['"]([^'"]+)['"]/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
]
const RESOLVABLE_SUFFIXES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']

function importedSpecifiers(source: string): string[] {
  return SPECIFIER_PATTERNS.flatMap((pattern) => Array.from(source.matchAll(pattern), (match) => match[1]))
}

function resolveSourceFile(specifier: string, importer: string): string | null {
  let base: string | null = null
  if (specifier.startsWith('.')) base = path.resolve(path.dirname(importer), specifier)
  else if (specifier.startsWith('@open-mercato/core/')) base = path.join(SRC_ROOT, specifier.slice('@open-mercato/core/'.length))
  else if (specifier.startsWith('@open-mercato/shared/')) base = path.join(SHARED_SRC_ROOT, specifier.slice('@open-mercato/shared/'.length))
  if (base === null) return null
  for (const suffix of RESOLVABLE_SUFFIXES) {
    const candidate = `${base}${suffix}`
    if (existsSync(candidate) && /\.tsx?$/.test(candidate)) return candidate
  }
  return null
}

function collectImportGraph(entry: string): { files: Set<string>; specifiers: Map<string, string[]> } {
  const files = new Set<string>()
  const specifiers = new Map<string, string[]>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop() as string
    if (files.has(file)) continue
    files.add(file)
    const imported = importedSpecifiers(readFileSync(file, 'utf8'))
    specifiers.set(file, imported)
    for (const specifier of imported) {
      const resolved = resolveSourceFile(specifier, file)
      if (resolved) queue.push(resolved)
    }
  }
  return { files, specifiers }
}

describe('oauthGrantFixtures', () => {
  it('is a pure re-export of the fake authorization server', () => {
    const lines = readFileSync(FIXTURES_FILE, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    expect(lines).toEqual(["export * from '../../modules/integrations/lib/oauth/testing/fakeAuthorizationServer'"])
    expect(Object.keys(oauthGrantFixtures).sort()).toEqual(Object.keys(fakeAuthorizationServer).sort())
    expect(oauthGrantFixtures.startFakeAuthorizationServer).toBe(fakeAuthorizationServer.startFakeAuthorizationServer)
  })

  it.each([
    ['fakeAuthorizationServer', FAKE_SERVER_FILE],
    ['oauthGrantFixtures', FIXTURES_FILE],
  ])('%s does not reach @playwright/test, directly or through another helper', (_label, entry) => {
    const { files, specifiers } = collectImportGraph(entry)

    expect(files.has(entry)).toBe(true)
    for (const [file, imported] of specifiers) {
      const playwrightImports = imported.filter((specifier) => PLAYWRIGHT_SPECIFIER.test(specifier))
      expect({ file: path.relative(SRC_ROOT, file), playwrightImports }).toEqual({
        file: path.relative(SRC_ROOT, file),
        playwrightImports: [],
      })
    }
  })

  it('the import graph walk sees the helper graph (guards against a vacuous pass)', () => {
    const { files } = collectImportGraph(path.join(SRC_ROOT, 'helpers/integration/pushFake.ts'))
    const playwrightHolders = Array.from(files).filter((file) =>
      importedSpecifiers(readFileSync(file, 'utf8')).some((specifier) => PLAYWRIGHT_SPECIFIER.test(specifier)),
    )

    expect(playwrightHolders.length).toBeGreaterThan(0)
  })

  it('the fake authorization server runtime-imports node:http and node:crypto only', () => {
    const runtimeSource = readFileSync(FAKE_SERVER_FILE, 'utf8')
      .split('\n')
      .filter((line) => !/^\s*import type /.test(line))
      .join('\n')

    expect(importedSpecifiers(runtimeSource).sort()).toEqual(['node:crypto', 'node:http'])
  })
})
