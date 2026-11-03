/** @jest-environment node */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const PACKAGES_ROOT = path.resolve(__dirname, '../../../../../../..')
const CORE_SRC_ROOT = path.join(PACKAGES_ROOT, 'core/src')
const SHARED_SRC_ROOT = path.join(PACKAGES_ROOT, 'shared/src')
const INTEGRATIONS_ROOT = path.join(CORE_SRC_ROOT, 'modules/integrations')
const TEST_ROUTE_FILE = path.join(INTEGRATIONS_ROOT, 'api/post/test-oauth-grants/route.ts')
const TEST_INTEGRATION_FILE = path.join(INTEGRATIONS_ROOT, 'integration.ts')
const DETAIL_PAGE_FILE = path.join(INTEGRATIONS_ROOT, 'backend/integrations/[id]/page.tsx')

const OAUTH_LIB_ROOT = path.join(INTEGRATIONS_ROOT, 'lib/oauth')
const OAUTH_LIB_SPECIFIER = /(?:^|\/)integrations\/lib\/oauth(?:\/|$)/
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.next', '.turbo', 'generated'])
const SPECIFIER_PATTERNS = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\s+['"]([^'"]+)['"]/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bjest\.mock\(\s*['"]([^'"]+)['"]/g,
]
const PACKAGE_SOURCE_ROOTS: ReadonlyArray<[string, string]> = [
  ['@open-mercato/core/', CORE_SRC_ROOT],
  ['@open-mercato/shared/', SHARED_SRC_ROOT],
]
const SOURCE_SUFFIXES = ['.ts', '.tsx']

function importedSpecifiers(source: string): string[] {
  return SPECIFIER_PATTERNS.flatMap((pattern) => Array.from(source.matchAll(pattern), (match) => match[1]))
}

function importsOAuthLib(importer: string, specifier: string): boolean {
  if (!specifier.startsWith('.')) return OAUTH_LIB_SPECIFIER.test(specifier)
  const target = path.resolve(path.dirname(importer), specifier)
  return target === OAUTH_LIB_ROOT || target.startsWith(`${OAUTH_LIB_ROOT}${path.sep}`)
}

function listTsxFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) files.push(...listTsxFiles(path.join(directory, entry.name)))
    } else if (entry.isFile() && entry.name.endsWith('.tsx')) {
      files.push(path.join(directory, entry.name))
    }
  }
  return files
}

function packageSourceRoots(): string[] {
  return readdirSync(PACKAGES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(PACKAGES_ROOT, entry.name, 'src'))
    .filter((sourceRoot) => existsSync(sourceRoot))
}

function resolvesToPublishedSourceFile(specifier: string): boolean {
  for (const [prefix, sourceRoot] of PACKAGE_SOURCE_ROOTS) {
    if (!specifier.startsWith(prefix)) continue
    const base = path.join(sourceRoot, specifier.slice(prefix.length))
    return SOURCE_SUFFIXES.some((suffix) => existsSync(`${base}${suffix}`))
  }
  return true
}

describe('OAuth grant client boundary (A35)', () => {
  it('finds the .tsx files of every package, including the integration detail page', () => {
    const tsxFiles = packageSourceRoots().flatMap(listTsxFiles)

    expect(tsxFiles.length).toBeGreaterThan(100)
    expect(tsxFiles).toContain(DETAIL_PAGE_FILE)
  })

  it('detects an import of integrations/lib/oauth in any specifier shape', () => {
    const samples = [
      "import { createPkcePair } from '@open-mercato/core/modules/integrations/lib/oauth/pkce'",
      "import type { OAuthGrantOwner } from '../../../lib/oauth/descriptor'",
      "const health = await import('@open-mercato/core/modules/integrations/lib/oauth')",
    ]

    for (const sample of samples) {
      expect(importedSpecifiers(sample).some((specifier) => importsOAuthLib(DETAIL_PAGE_FILE, specifier))).toBe(true)
    }
    expect(importsOAuthLib(DETAIL_PAGE_FILE, '@open-mercato/core/modules/integrations/lib/oauth-state')).toBe(false)
    expect(importsOAuthLib(DETAIL_PAGE_FILE, '../../../lib/credentials-service')).toBe(false)
  })

  it('no .tsx file under packages/*/src imports integrations/lib/oauth', () => {
    const offenders = packageSourceRoots()
      .flatMap(listTsxFiles)
      .flatMap((file) => importedSpecifiers(readFileSync(file, 'utf8'))
        .filter((specifier) => importsOAuthLib(file, specifier))
        .map((specifier) => `${path.relative(PACKAGES_ROOT, file)} -> ${specifier}`))

    expect(offenders).toEqual([])
  })

  it.each([
    ['the test-only route', TEST_ROUTE_FILE],
    ['the test_oauth_grant integration', TEST_INTEGRATION_FILE],
  ])('%s imports only package subpaths that resolve to a source file', (_label, file) => {
    const specifiers = importedSpecifiers(readFileSync(file, 'utf8'))

    expect(specifiers.length).toBeGreaterThan(0)
    expect(specifiers.filter((specifier) => specifier.startsWith('.'))).toEqual([])
    expect(specifiers.filter((specifier) => !resolvesToPublishedSourceFile(specifier))).toEqual([])
  })
})
