import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createTargetLocaleResolver,
  parseIsoLanguageCodesSource,
  parseLocaleConfigSource,
  readAppLocaleSet,
  readIsoLanguageCodes,
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

const ISO_TABLE_PATH = path.join('packages', 'shared', 'src', 'lib', 'i18n', 'iso639.ts')
const LANGUAGE_CODES = readIsoLanguageCodes(REPO_ROOT)
const APP_LOCALE_OPTIONS = { languageCodes: LANGUAGE_CODES, declaredLocales: ['en', 'pl', 'es', 'de', 'ko'] }

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

function makePlatformRepo(files) {
  return makeRepo({
    'packages/shared/src/lib/i18n/config.ts': CONFIG_SOURCE,
    [ISO_TABLE_PATH]: fs.readFileSync(path.join(REPO_ROOT, ISO_TABLE_PATH), 'utf-8'),
    ...files,
  })
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

test('parseLocaleConfigSource ignores declarations that are commented out', () => {
  const source = [
    "// export const locales: Locale[] = ['en']",
    "/* export const defaultLocale: Locale = 'pl' */",
    "export const locales: Locale[] = [",
    "  'en', // reference",
    "  /* added */ 'cs',",
    ']',
    "export const defaultLocale: Locale = 'en' // keep in sync",
  ].join('\n')
  assert.deepEqual(parseLocaleConfigSource(source), { locales: ['en', 'cs'], defaultLocale: 'en' })
})

test('parseLocaleConfigSource keeps comment markers inside string literals', () => {
  const source = "const note = 'see https://example.com /* not a comment'\nexport const locales = ['en']\nexport const defaultLocale = 'en'\n"
  assert.deepEqual(parseLocaleConfigSource(source), { locales: ['en'], defaultLocale: 'en' })
})

test('parseLocaleConfigSource rejects a second locales or defaultLocale declaration', () => {
  assert.throws(
    () => parseLocaleConfigSource("export const locales = ['en']\nexport const locales = ['en', 'pl']\nexport const defaultLocale = 'en'"),
    /`locales` more than once/,
  )
  assert.throws(
    () => parseLocaleConfigSource("export const locales = ['en']\nexport const defaultLocale = 'en'\nexport const defaultLocale = 'en'"),
    /`defaultLocale` more than once/,
  )
})

test('parseLocaleConfigSource rejects declared locales that are not normalized', () => {
  const withDefault = (array) => `export const locales = ${array}\nexport const defaultLocale = 'en'\n`
  assert.throws(() => parseLocaleConfigSource(withDefault("['en', 'pt_BR']")), /"pt_BR".*normalized/)
  assert.throws(() => parseLocaleConfigSource(withDefault("['en', 'DE']")), /"DE".*normalized/)
  assert.deepEqual(parseLocaleConfigSource(withDefault("['en', 'pt-br', 'fil']")).locales, ['en', 'pt-br', 'fil'])
})

test('parseLocaleConfigSource requires defaultLocale to be a single string literal', () => {
  const withLocales = (value) => `export const locales = ['en', 'pl']\nexport const defaultLocale: Locale = ${value}\n`
  assert.throws(() => parseLocaleConfigSource(withLocales("'en' + suffix")), /single string literal/)
  assert.throws(() => parseLocaleConfigSource(withLocales('fallbackLocale')), /single string literal/)
  assert.throws(() => parseLocaleConfigSource(withLocales("`en`")), /single string literal/)
  assert.equal(parseLocaleConfigSource(withLocales("'pl';")).defaultLocale, 'pl')
  assert.equal(parseLocaleConfigSource(withLocales("'pl' as const")).defaultLocale, 'pl')
  assert.equal(parseLocaleConfigSource(withLocales("'pl' as Locale")).defaultLocale, 'pl')
  assert.equal(parseLocaleConfigSource(withLocales("'pl' satisfies Locale")).defaultLocale, 'pl')
})

test('parseIsoLanguageCodesSource reads two-letter codes and fails closed on an unreadable table', () => {
  const codes = parseIsoLanguageCodesSource("export const ISO_639_1 = [\n  { code: 'aa', label: 'Afar' },\n  { code: \"zu\", label: 'Zulu' },\n]")
  assert.deepEqual([...codes], ['aa', 'zu'])
  assert.throws(() => parseIsoLanguageCodesSource('export const ISO_639_1 = []'), /ISO 639-1/)
})

test('readIsoLanguageCodes reads the real platform ISO 639-1 table', () => {
  assert.ok(LANGUAGE_CODES.has('en'))
  assert.ok(LANGUAGE_CODES.has('xh'))
  assert.equal(LANGUAGE_CODES.has('faq'), false)
  assert.equal(LANGUAGE_CODES.has('app'), false)
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
    'apps/app/src/i18n/nested/zu.json': '{}',
  })
  assert.deepEqual(readAppLocaleSet(path.join(root, 'apps', 'app'), APP_LOCALE_OPTIONS).sort(), ['en', 'pt-br', 'xh'])
})

test('readAppLocaleSet ignores JSON files whose name is not a language code', () => {
  const root = makeRepo({
    'apps/app/src/i18n/en.json': '{}',
    'apps/app/src/i18n/zh-hant.json': '{}',
    'apps/app/src/i18n/faq.json': '{}',
    'apps/app/src/i18n/app.json': '{}',
    'apps/app/src/i18n/FAQ.json': '{}',
    'apps/app/src/i18n/ui-kit.json': '{}',
    'apps/app/src/i18n/qq.json': '{}',
    'apps/app/src/i18n/my-app.json': '{}',
    'apps/app/src/i18n/id-map.json': '{}',
    'apps/app/src/i18n/es-419.json': '{}',
    'apps/app/src/i18n/sr-latn-rs.json': '{}',
  })
  assert.deepEqual(readAppLocaleSet(path.join(root, 'apps', 'app'), APP_LOCALE_OPTIONS).sort(), [
    'en',
    'es-419',
    'sr-latn-rs',
    'zh-hant',
  ])
})

test('readAppLocaleSet keeps variant locales that registerLocales accepts', () => {
  const root = makeRepo({
    'apps/app/src/i18n/en.json': '{}',
    'apps/app/src/i18n/ca-valencia.json': '{}',
    'apps/app/src/i18n/de-1996.json': '{}',
    'apps/app/src/i18n/sl-rozaj-biske.json': '{}',
  })
  assert.deepEqual(readAppLocaleSet(path.join(root, 'apps', 'app'), APP_LOCALE_OPTIONS).sort(), [
    'ca-valencia',
    'de-1996',
    'en',
    'sl-rozaj-biske',
  ])
})

test('a file name shaped like a variant locale is read as a locale, matching registerLocales', () => {
  const root = makeRepo({ 'apps/app/src/i18n/en.json': '{}', 'apps/app/src/i18n/en-config.json': '{}' })
  assert.deepEqual(readAppLocaleSet(path.join(root, 'apps', 'app'), APP_LOCALE_OPTIONS).sort(), ['en', 'en-config'])
})

test('readAppLocaleSet accepts a non-ISO-639-1 code only when the config declares it', () => {
  const root = makeRepo({ 'apps/app/src/i18n/en.json': '{}', 'apps/app/src/i18n/fil.json': '{}' })
  const appRoot = path.join(root, 'apps', 'app')
  assert.deepEqual(readAppLocaleSet(appRoot, APP_LOCALE_OPTIONS), ['en'])
  assert.deepEqual(
    readAppLocaleSet(appRoot, { ...APP_LOCALE_OPTIONS, declaredLocales: [...APP_LOCALE_OPTIONS.declaredLocales, 'fil'] }).sort(),
    ['en', 'fil'],
  )
})

test('readAppLocaleSet requires the ISO language codes', () => {
  const root = makeRepo({ 'apps/app/src/i18n/en.json': '{}' })
  assert.throws(() => readAppLocaleSet(path.join(root, 'apps', 'app')), /ISO 639-1/)
})

test('readAppLocaleSet fails closed on locale files that are not in normalized form', () => {
  const root = makeRepo({
    'apps/app/src/i18n/en.json': '{}',
    'apps/app/src/i18n/pt-BR.json': '{}',
    'apps/app/src/i18n/zh_Hant.json': '{}',
  })
  assert.throws(
    () => readAppLocaleSet(path.join(root, 'apps', 'app'), APP_LOCALE_OPTIONS),
    (error) => error.message.includes('pt-BR.json -> pt-br.json') && error.message.includes('zh_Hant.json -> zh-hant.json'),
  )
})

test('readAppLocaleSet returns null when the app has no locale files', () => {
  const root = makeRepo({ 'apps/empty/src/i18n/README.md': '', 'apps/empty/src/i18n/faq.json': '{}', 'apps/none/package.json': '{}' })
  assert.equal(readAppLocaleSet(path.join(root, 'apps', 'empty'), APP_LOCALE_OPTIONS), null)
  assert.equal(readAppLocaleSet(path.join(root, 'apps', 'none'), APP_LOCALE_OPTIONS), null)
})

test('platform modules target the platform set without the reference locale', () => {
  const root = makePlatformRepo({})
  const resolver = createTargetLocaleResolver({ root, referenceLocale: 'en' })
  const enPath = path.join(root, 'packages', 'core', 'src', 'modules', 'auth', 'i18n', 'en.json')
  assert.deepEqual(resolver.targetsFor(enPath), ['pl', 'es', 'de', 'ko'])
  assert.deepEqual(resolver.describeScope(enPath), { scope: 'platform', locales: ['en', 'pl', 'es', 'de', 'ko'] })
})

test('app modules target the app locale set, so an app can add and drop languages', () => {
  const root = makePlatformRepo({
    'apps/custom/src/i18n/en.json': '{}',
    'apps/custom/src/i18n/zu.json': '{}',
    'apps/custom/src/i18n/xh.json': '{}',
    'apps/custom/src/i18n/st.json': '{}',
    'apps/custom/src/i18n/faq.json': '{}',
    'apps/custom/src/i18n/app.json': '{}',
  })
  const resolver = createTargetLocaleResolver({ root, referenceLocale: 'en' })
  const moduleEn = path.join(root, 'apps', 'custom', 'src', 'modules', 'records', 'i18n', 'en.json')
  const appEn = path.join(root, 'apps', 'custom', 'src', 'i18n', 'en.json')
  assert.deepEqual(resolver.targetsFor(moduleEn), ['st', 'xh', 'zu'])
  assert.deepEqual(resolver.targetsFor(appEn), ['st', 'xh', 'zu'])
  assert.deepEqual(resolver.describeScope(moduleEn), { scope: 'apps/custom', locales: ['en', 'st', 'xh', 'zu'] })
})

test('app locale sets keep platform order for shared locales and append added ones', () => {
  const root = makePlatformRepo({
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
  const root = makePlatformRepo({ 'apps/docs/package.json': '{}' })
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
  const noIsoTableRoot = makeRepo({ 'packages/shared/src/lib/i18n/config.ts': CONFIG_SOURCE })
  assert.throws(() => createTargetLocaleResolver({ root: noIsoTableRoot, referenceLocale: 'en' }), /ENOENT/)
})

test('the resolver keeps a config-declared extra locale for app modules', () => {
  const extendedConfig = CONFIG_SOURCE.replace("'ko']", "'ko', 'fil']")
  const root = makePlatformRepo({
    'packages/shared/src/lib/i18n/config.ts': extendedConfig,
    'apps/custom/src/i18n/en.json': '{}',
    'apps/custom/src/i18n/fil.json': '{}',
    'apps/custom/src/i18n/faq.json': '{}',
  })
  const resolver = createTargetLocaleResolver({ root, referenceLocale: 'en' })
  const enPath = path.join(root, 'apps', 'custom', 'src', 'modules', 'm', 'i18n', 'en.json')
  assert.deepEqual(resolver.targetsFor(enPath), ['fil'])
})
