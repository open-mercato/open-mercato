import { readFileSync } from 'node:fs'
import { basename, dirname, relative, resolve } from 'node:path'
import fg from 'fast-glob'
import * as ts from 'typescript'
import englishDictionary from '../i18n/en.json'
import germanDictionary from '../i18n/de.json'
import spanishDictionary from '../i18n/es.json'
import koreanDictionary from '../i18n/ko.json'
import polishDictionary from '../i18n/pl.json'

const repoRoot = resolve(__dirname, '../../../../../..')
const featureKeyPrefix = 'auth.acl.features.'
const moduleKeyPrefix = 'auth.acl.modules.'
const dictionaries: Record<string, Record<string, string>> = {
  de: germanDictionary,
  en: englishDictionary,
  es: spanishDictionary,
  ko: koreanDictionary,
  pl: polishDictionary,
}

type DeclaredFeature = {
  id: string
  title: string
  path: string
}

function propertyName(name: ts.PropertyName): string | null {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null
}

function readStringProperty(object: ts.ObjectLiteralExpression, name: string, path: string): string {
  const property = object.properties.find(
    (candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate) && propertyName(candidate.name) === name,
  )
  if (!property || !ts.isStringLiteralLike(property.initializer)) {
    throw new Error(`${path} must declare every feature ${name} as a string literal`)
  }
  return property.initializer.text
}

function readDeclaredFeatures(file: string): DeclaredFeature[] {
  const path = relative(repoRoot, file).replaceAll('\\', '/')
  const source = readFileSync(file, 'utf8')
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let initializer: ts.ArrayLiteralExpression | null = null

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      const expression = declaration.initializer && ts.isAsExpression(declaration.initializer)
        ? declaration.initializer.expression
        : declaration.initializer
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === 'features' &&
        expression &&
        ts.isArrayLiteralExpression(expression)
      ) {
        initializer = expression
      }
    }
  }

  if (!initializer) throw new Error(`${path} must export a literal features array`)

  return initializer.elements.map((element) => {
    if (!ts.isObjectLiteralExpression(element)) {
      throw new Error(`${path} must declare every feature as an object literal`)
    }
    return {
      id: readStringProperty(element, 'id', path),
      title: readStringProperty(element, 'title', path),
      path,
    }
  })
}

describe('ACL feature translation catalog', () => {
  it('keeps English titles aligned with every discovered module ACL declaration', async () => {
    const files = await fg(
      ['packages/*/src/modules/*/acl.ts', 'apps/mercato/src/modules/*/acl.ts'],
      { cwd: repoRoot, absolute: true },
    )
    const declaredFeatures = files.flatMap(readDeclaredFeatures)
    const declaredIds = new Set(declaredFeatures.map((feature) => feature.id))
    const findings: string[] = []

    for (const feature of declaredFeatures) {
      const key = `${featureKeyPrefix}${feature.id}`
      const catalogTitle = (englishDictionary as Record<string, string>)[key]
      if (catalogTitle !== feature.title) {
        findings.push(`${feature.path}: ${key} expected ${JSON.stringify(feature.title)}, received ${JSON.stringify(catalogTitle)}`)
      }
    }

    for (const key of Object.keys(englishDictionary)) {
      if (key.startsWith(featureKeyPrefix) && !declaredIds.has(key.slice(featureKeyPrefix.length))) {
        findings.push(`auth/i18n/en.json: ${key} has no discovered ACL declaration`)
      }
    }

    expect(findings).toEqual([])
  })

  it('labels every communication channel permission group in every locale', async () => {
    const files = await fg(['packages/channel-*/src/modules/*/acl.ts'], { cwd: repoRoot, absolute: true })
    const moduleIds = files.map((file) => basename(dirname(file))).sort()
    const findings: string[] = []

    expect(moduleIds).toEqual(expect.arrayContaining(['channel_discord', 'channel_resend', 'channel_ses']))

    for (const [locale, dictionary] of Object.entries(dictionaries)) {
      for (const moduleId of moduleIds) {
        const label = dictionary[`${moduleKeyPrefix}${moduleId}`]
        if (!label || label === moduleId) {
          findings.push(`auth/i18n/${locale}.json: ${moduleKeyPrefix}${moduleId} is missing`)
        }
      }
    }

    expect(findings).toEqual([])
  })
})
