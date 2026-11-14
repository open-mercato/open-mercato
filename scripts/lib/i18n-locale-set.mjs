import fs from 'node:fs'
import path from 'node:path'

export const PLATFORM_LOCALE_CONFIG_PATH = path.join('packages', 'shared', 'src', 'lib', 'i18n', 'config.ts')
export const ISO_LANGUAGE_CODES_PATH = path.join('packages', 'shared', 'src', 'lib', 'i18n', 'iso639.ts')

const LOCALE_CODE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/
const LOCALE_FILE_PATTERN = /^([a-z]{2,3}(?:-[a-z0-9]{2,8})*)\.json$/
const LOCALE_SHAPED_FILE_PATTERN = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*\.json$/
const STRING_LITERAL_PATTERN = /^(?:'([^'\\]+)'|"([^"\\]+)")$/
const ISO_CODE_ENTRY_PATTERN = /\bcode:\s*(?:'([a-z]{2})'|"([a-z]{2})")/g

function stripComments(source) {
  let output = ''
  let index = 0
  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]
    if (char === '/' && next === '/') {
      const lineEnd = source.indexOf('\n', index)
      index = lineEnd === -1 ? source.length : lineEnd
      continue
    }
    if (char === '/' && next === '*') {
      const commentEnd = source.indexOf('*/', index + 2)
      if (commentEnd === -1) throw new Error('The platform i18n config contains an unterminated block comment')
      output += ' '
      index = commentEnd + 2
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      let cursor = index + 1
      while (cursor < source.length && source[cursor] !== char) cursor += source[cursor] === '\\' ? 2 : 1
      output += source.slice(index, cursor + 1)
      index = cursor + 1
      continue
    }
    output += char
    index += 1
  }
  return output
}

function assertSingleDeclaration(source, variableName) {
  const declarations = source.match(new RegExp(`\\bexport\\s+const\\s+${variableName}\\b`, 'g')) ?? []
  if (declarations.length > 1) {
    throw new Error(`The platform i18n config declares \`${variableName}\` more than once`)
  }
}

function assertNormalizedLocale(locale, variableName) {
  if (!LOCALE_CODE_PATTERN.test(locale)) {
    throw new Error(
      `The \`${variableName}\` literal in the platform i18n config contains "${locale}", which is not a normalized lowercase, hyphenated locale code`,
    )
  }
}

function parseStringArrayLiteral(source, variableName) {
  const match = source.match(new RegExp(`export\\s+const\\s+${variableName}\\s*(?::[^=]+)?=\\s*\\[([^\\]]*)\\]`))
  if (!match) return null
  const members = match[1].split(',').map((member) => member.trim())
  if (members.length > 0 && members[members.length - 1] === '') members.pop()
  const values = members.map((member) => member.match(STRING_LITERAL_PATTERN))
  if (values.length === 0 || values.some((literal) => !literal)) {
    throw new Error(`The \`${variableName}\` literal in the platform i18n config must contain only string literals`)
  }
  const locales = values.map((literal) => literal[1] ?? literal[2])
  for (const locale of locales) assertNormalizedLocale(locale, variableName)
  if (new Set(locales).size !== locales.length) {
    throw new Error(`The \`${variableName}\` literal in the platform i18n config contains duplicate entries`)
  }
  return locales
}

function parseStringLiteral(source, variableName) {
  const declaration = source.match(new RegExp(`export\\s+const\\s+${variableName}\\s*(?::[^=]+)?=\\s*([^\\n;]*)`))
  if (!declaration) return null
  const literal = declaration[1].replace(/\s+(?:as|satisfies)\s+[A-Za-z_$][\w$.]*\s*$/, '').trim().match(STRING_LITERAL_PATTERN)
  if (!literal) {
    throw new Error(`The \`${variableName}\` declaration in the platform i18n config must be a single string literal`)
  }
  return literal[1] ?? literal[2]
}

export function parseLocaleConfigSource(rawSource) {
  const source = stripComments(rawSource)
  assertSingleDeclaration(source, 'locales')
  assertSingleDeclaration(source, 'defaultLocale')
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

export function parseIsoLanguageCodesSource(source) {
  const codes = [...source.matchAll(ISO_CODE_ENTRY_PATTERN)].map((match) => match[1] ?? match[2])
  if (codes.length === 0) throw new Error('Could not read the ISO 639-1 language codes from the platform i18n table')
  return new Set(codes)
}

export function readIsoLanguageCodes(root) {
  return parseIsoLanguageCodesSource(fs.readFileSync(path.join(root, ISO_LANGUAGE_CODES_PATH), 'utf-8'))
}

function isWellFormedLanguageTag(locale) {
  try {
    return Intl.getCanonicalLocales(locale).length === 1
  } catch {
    return false
  }
}

function createLocaleRecognizer({ languageCodes, declaredLocales }) {
  if (!(languageCodes instanceof Set) || languageCodes.size === 0) {
    throw new Error('Recognizing locale files requires the ISO 639-1 language codes')
  }
  const declared = new Set(declaredLocales)
  return (locale) =>
    declared.has(locale) || (languageCodes.has(locale.split('-')[0]) && isWellFormedLanguageTag(locale))
}

function normalizeFileStem(fileName) {
  return fileName.replace(/\.json$/, '').toLowerCase().replace(/_/g, '-')
}

export function resolveAppRoot(root, filePath) {
  const segments = path.relative(root, filePath).split(/[\\/]/)
  if (segments.length < 2 || segments[0] !== 'apps') return null
  return path.join(root, segments[0], segments[1])
}

export function readAppLocaleSet(appRoot, { languageCodes, declaredLocales = [] } = {}) {
  const isRecognizedLocale = createLocaleRecognizer({ languageCodes, declaredLocales })
  const i18nDir = path.join(appRoot, 'src', 'i18n')
  if (!fs.existsSync(i18nDir)) return null
  const fileNames = fs
    .readdirSync(i18nDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
  const unnormalized = fileNames.filter(
    (name) => LOCALE_SHAPED_FILE_PATTERN.test(name) && !LOCALE_FILE_PATTERN.test(name) && isRecognizedLocale(normalizeFileStem(name)),
  )
  if (unnormalized.length > 0) {
    const renames = unnormalized.map((name) => `${name} -> ${normalizeFileStem(name)}.json`).join(', ')
    throw new Error(`Locale files in ${i18nDir} must use normalized lowercase, hyphenated codes: ${renames}`)
  }
  const locales = fileNames
    .map((name) => name.match(LOCALE_FILE_PATTERN)?.[1])
    .filter((locale) => Boolean(locale) && isRecognizedLocale(locale))
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

export function createTargetLocaleResolver({
  root,
  referenceLocale,
  platform = readPlatformLocaleSet(root),
  languageCodes = readIsoLanguageCodes(root),
}) {
  const appLocaleOptions = { languageCodes, declaredLocales: platform.locales }
  const appLocaleCache = new Map()

  const describeScope = (enJsonPath) => {
    const appRoot = resolveAppRoot(root, enJsonPath)
    if (!appRoot) return { scope: 'platform', locales: platform.locales }
    if (!appLocaleCache.has(appRoot)) appLocaleCache.set(appRoot, readAppLocaleSet(appRoot, appLocaleOptions))
    const appLocales = appLocaleCache.get(appRoot)
    if (!appLocales) return { scope: 'platform', locales: platform.locales }
    return { scope: path.relative(root, appRoot).split(path.sep).join('/'), locales: orderLocales(appLocales, platform.locales) }
  }

  return {
    platform,
    describeScope,
    targetsFor(enJsonPath) {
      return describeScope(enJsonPath).locales.filter((locale) => locale !== referenceLocale)
    },
  }
}
