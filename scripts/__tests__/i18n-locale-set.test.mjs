import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createTargetLocaleResolver,
  parseLocaleConfigSource,
  readAppLocaleSet,
  readPlatformLocaleSet,
  resolveAppRoot,
} from '../lib/i18n-locale-set.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const CONFIG_SOURCE = `
/**
 * Mentions locales and defaultLocale in prose, and \`Record<Locale, T>\`.
 */
export interface LocaleRegistry { en: true; pl: true; es: true; de: true; ko: true }
export type Locale = keyof LocaleRegistry & string
export const locales: Locale[] = ['en', 'pl', 'es', 'de', 'ko']
export const defaultLocale: Locale = 'en'
`

const createdRoots = []

test.after(() => {
  for (const root of createdRoots) fs.rmSync(root, { recursive: true, force: true })
})

function makeRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-locale-set-'))
  createdRoots.push(root)
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(root, relativePath)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, contents)
  }
  return root
}

test('parseLocaleConfigSource reads the locales and defaultLocale literals', () => {
  assert.deepEqual(parseLocaleConfigSource(CONFIG_SOURCE), {
    locales: ['en', 'pl', 'es', 'de', 'ko'],
    defaultLocale: 'en',
  })
})

test('parseLocaleConfigSource accepts double quotes and no type annotation', () => {
  const source = `export const locales = ["en", "cs"]\nexport const defaultLocale = "en"\n`
  assert.deepEqual(parseLocaleConfigSource(source), { locales: ['en', 'cs'], defaultLocale: 'en' })
})

test('parseLocaleConfigSource fails closed when the literals are missing or inconsistent', () => {
  assert.throws(() => parseLocaleConfigSource('export const defaultLocale = "en"'), /locales/)
  assert.throws(() => parseLocaleConfigSource("export const locales = ['en']"), /defaultLocale/)
  assert.throws(
    () => parseLocaleConfigSource("export const locales = ['pl']\nexport const defaultLocale = 'en'"),
    /defaultLocale/,
  )
})

test('parseLocaleConfigSource accepts a multi-line array with a trailing comma', () => {
  const source = "export const locales: Locale[] = [\n  'en',\n  'pl',\n]\nexport const defaultLocale: Locale = 'en'\n"
  assert.deepEqual(parseLocaleConfigSource(source), { locales: ['en', 'pl'], defaultLocale: 'en' })
})

test('parseLocaleConfigSource rejects a partially readable locales array instead of dropping members', () => {
  const withDefault = (array) => `export const locales = ${array}\nexport const defaultLocale = 'en'\n`
  assert.throws(() => parseLocaleConfigSource(withDefault("['en', ...extraLocales]")), /only string literals/)
  assert.throws(() => parseLocaleConfigSource(withDefault("['en', EXTRA_LOCALE]")), /only string literals/)
  assert.throws(() => parseLocaleConfigSource(withDefault("['en', , 'pl']")), /only string literals/)
  assert.throws(() => parseLocaleConfigSource(withDefault('[]')), /only string literals/)
  assert.throws(() => parseLocaleConfigSource(withDefault("['en', 'pl', 'en']")), /duplicate/)
})

test('readPlatformLocaleSet parses the real platform config', () => {
  const platform = readPlatformLocaleSet(REPO_ROOT)
  assert.ok(platform.locales.includes('en'))
  assert.ok(platform.locales.includes(platform.defaultLocale))
})

test('resolveAppRoot only matches files under apps/<app>/', () => {
  const root = path.join(os.tmpdir(), 'repo')
  assert.equal(
    resolveAppRoot(root, path.join(root, 'apps', 'mercato', 'src', 'modules', 'example', 'i18n', 'en.json')),
    path.join(root, 'apps', 'mercato'),
  )
  assert.equal(resolveAppRoot(root, path.join(root, 'apps', 'mercato', 'src', 'i18n', 'en.json')), path.join(root, 'apps', 'mercato'))
  assert.equal(resolveAppRoot(root, path.join(root, 'packages', 'core', 'src', 'modules', 'auth', 'i18n', 'en.json')), null)
  assert.equal(resolveAppRoot(root, path.join(root, 'external', 'official-modules', 'packages', 'x', 'i18n', 'en.json')), null)
  assert.equal(resolveAppRoot(root, path.join(root, 'apps')), null)
})

test('readAppLocaleSet lists locale files and ignores everything else', () => {
  const root = makeRepo({
    'apps/app/src/i18n/en.json': '{}',
    'apps/app/src/i18n/xh.json': '{}',
    'apps/app/src/i18n/pt-br.json': '{}',
    'apps/app/src/i18n/.hardcoded-allowlist.json': '{}',
    'apps/app/src/i18n/README.md': '',
    'apps/app/src/i18n/en_US.json': '{}',
    'apps/app/src/i18n/nested/zu.json': '{}',
  })
  assert.deepEqual(readAppLocaleSet(path.join(root, 'apps', 'app')).sort(), ['en', 'pt-br', 'xh'])
})

test('readAppLocaleSet returns null when the app has no locale files', () => {
  const root = makeRepo({ 'apps/empty/src/i18n/README.md': '', 'apps/none/package.json': '{}' })
  assert.equal(readAppLocaleSet(path.join(root, 'apps', 'empty')), null)
  assert.equal(readAppLocaleSet(path.join(root, 'apps', 'none')), null)
})

test('platform modules target the platform set without the reference locale', () => {
  const root = makeRepo({ 'packages/shared/src/lib/i18n/config.ts': CONFIG_SOURCE })
  const resolver = createTargetLocaleResolver({ root, referenceLocale: 'en' })
  const enPath = path.join(root, 'packages', 'core', 'src', 'modules', 'auth', 'i18n', 'en.json')
  assert.deepEqual(resolver.targetsFor(enPath), ['pl', 'es', 'de', 'ko'])
  assert.deepEqual(resolver.describeScope(enPath), { scope: 'platform', locales: ['en', 'pl', 'es', 'de', 'ko'] })
})

test('app modules target the app locale set, so an app can add and drop languages', () => {
  const root = makeRepo({
    'packages/shared/src/lib/i18n/config.ts': CONFIG_SOURCE,
    'apps/custom/src/i18n/en.json': '{}',
    'apps/custom/src/i18n/zu.json': '{}',
    'apps/custom/src/i18n/xh.json': '{}',
    'apps/custom/src/i18n/st.json': '{}',
  })
  const resolver = createTargetLocaleResolver({ root, referenceLocale: 'en' })
  const moduleEn = path.join(root, 'apps', 'custom', 'src', 'modules', 'records', 'i18n', 'en.json')
  const appEn = path.join(root, 'apps', 'custom', 'src', 'i18n', 'en.json')
  assert.deepEqual(resolver.targetsFor(moduleEn), ['st', 'xh', 'zu'])
  assert.deepEqual(resolver.targetsFor(appEn), ['st', 'xh', 'zu'])
  assert.deepEqual(resolver.describeScope(moduleEn), { scope: 'apps/custom', locales: ['en', 'st', 'xh', 'zu'] })
})

test('app locale sets keep platform order for shared locales and append added ones', () => {
  const root = makeRepo({
    'packages/shared/src/lib/i18n/config.ts': CONFIG_SOURCE,
    'apps/mixed/src/i18n/ko.json': '{}',
    'apps/mixed/src/i18n/cs.json': '{}',
    'apps/mixed/src/i18n/en.json': '{}',
    'apps/mixed/src/i18n/pl.json': '{}',
  })
  const resolver = createTargetLocaleResolver({ root, referenceLocale: 'en' })
  const enPath = path.join(root, 'apps', 'mixed', 'src', 'modules', 'm', 'i18n', 'en.json')
  assert.deepEqual(resolver.targetsFor(enPath), ['pl', 'ko', 'cs'])
})

test('an app without its own locale files falls back to the platform set', () => {
  const root = makeRepo({ 'packages/shared/src/lib/i18n/config.ts': CONFIG_SOURCE, 'apps/docs/package.json': '{}' })
  const resolver = createTargetLocaleResolver({ root, referenceLocale: 'en' })
  const enPath = path.join(root, 'apps', 'docs', 'src', 'modules', 'm', 'i18n', 'en.json')
  assert.deepEqual(resolver.targetsFor(enPath), ['pl', 'es', 'de', 'ko'])
  assert.equal(resolver.describeScope(enPath).scope, 'platform')
})

test('the resolver fails closed when the platform config cannot be read', () => {
  const root = makeRepo({ 'packages/shared/src/lib/i18n/config.ts': 'export const nothing = 1' })
  assert.throws(() => createTargetLocaleResolver({ root, referenceLocale: 'en' }), /locales/)
  const emptyRoot = makeRepo({})
  assert.throws(() => createTargetLocaleResolver({ root: emptyRoot, referenceLocale: 'en' }), /ENOENT/)
})
