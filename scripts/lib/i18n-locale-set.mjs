import fs from 'node:fs'
import path from 'node:path'

export const PLATFORM_LOCALE_CONFIG_PATH = path.join('packages', 'shared', 'src', 'lib', 'i18n', 'config.ts')

const LOCALE_FILE_PATTERN = /^([a-z]{2,3}(?:-[a-z0-9]{2,8})*)\.json$/

function parseStringArrayLiteral(source, variableName) {
  const match = source.match(new RegExp(`export\\s+const\\s+${variableName}\\s*(?::[^=]+)?=\\s*\\[([^\\]]*)\\]`))
  if (!match) return null
  return Array.from(match[1].matchAll(/'([^']+)'|"([^"]+)"/g), (entry) => entry[1] ?? entry[2])
}

function parseStringLiteral(source, variableName) {
  const match = source.match(new RegExp(`export\\s+const\\s+${variableName}\\s*(?::[^=]+)?=\\s*(?:'([^']+)'|"([^"]+)")`))
  return match ? (match[1] ?? match[2]) : null
}

export function parseLocaleConfigSource(source) {
  const locales = parseStringArrayLiteral(source, 'locales')
  const defaultLocale = parseStringLiteral(source, 'defaultLocale')
  if (!locales || locales.length === 0) {
    throw new Error('Could not read the `locales` literal from the platform i18n config')
  }
  if (!defaultLocale || !locales.includes(defaultLocale)) {
    throw new Error('Could not read a `defaultLocale` literal that is one of `locales` from the platform i18n config')
  }
  return { locales, defaultLocale }
}

export function readPlatformLocaleSet(root) {
  const configPath = path.join(root, PLATFORM_LOCALE_CONFIG_PATH)
  const source = fs.readFileSync(configPath, 'utf-8')
  return parseLocaleConfigSource(source)
}

export function resolveAppRoot(root, filePath) {
  const segments = path.relative(root, filePath).split(/[\\/]/)
  if (segments.length < 2 || segments[0] !== 'apps') return null
  return path.join(root, segments[0], segments[1])
}

export function readAppLocaleSet(appRoot) {
  const i18nDir = path.join(appRoot, 'src', 'i18n')
  if (!fs.existsSync(i18nDir)) return null
  const locales = fs
    .readdirSync(i18nDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name.match(LOCALE_FILE_PATTERN)?.[1])
    .filter((locale) => Boolean(locale))
  return locales.length > 0 ? locales : null
}

function orderLocales(locales, platformLocales) {
  const platformOrder = new Map(platformLocales.map((locale, index) => [locale, index]))
  return [...locales].sort((left, right) => {
    const leftIndex = platformOrder.get(left) ?? Number.POSITIVE_INFINITY
    const rightIndex = platformOrder.get(right) ?? Number.POSITIVE_INFINITY
    if (leftIndex !== rightIndex) return leftIndex - rightIndex
    return left < right ? -1 : left > right ? 1 : 0
  })
}

export function createTargetLocaleResolver({ root, referenceLocale, platform = readPlatformLocaleSet(root) }) {
  const appLocaleCache = new Map()
  const platformTargets = platform.locales.filter((locale) => locale !== referenceLocale)

  const describeScope = (enJsonPath) => {
    const appRoot = resolveAppRoot(root, enJsonPath)
    if (!appRoot) return { scope: 'platform', locales: platform.locales }
    if (!appLocaleCache.has(appRoot)) appLocaleCache.set(appRoot, readAppLocaleSet(appRoot))
    const appLocales = appLocaleCache.get(appRoot)
    if (!appLocales) return { scope: 'platform', locales: platform.locales }
    return { scope: path.relative(root, appRoot).split(path.sep).join('/'), locales: orderLocales(appLocales, platform.locales) }
  }

  return {
    platform,
    platformTargets,
    describeScope,
    targetsFor(enJsonPath) {
      return describeScope(enJsonPath).locales.filter((locale) => locale !== referenceLocale)
    },
  }
}
