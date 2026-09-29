import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import fg from 'fast-glob'
import * as ts from 'typescript'
import englishDictionary from '../i18n/en.json'

const repoRoot = resolve(__dirname, '../../../../../..')
const featureKeyPrefix = 'auth.acl.features.'

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
})
