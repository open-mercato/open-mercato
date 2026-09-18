import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import * as ts from 'typescript'
import fg from 'fast-glob'
import { dictionaryKeySchema } from '@open-mercato/core/modules/dictionaries/data/validators'

/**
 * Dictionary key coverage guard.
 *
 * A module that owns a system dictionary declares its key as a source constant and then reaches
 * the dictionary two ways: the seed writes the row straight through the EntityManager, while the
 * browser-side helper creates it on demand through `POST /api/dictionaries`, which validates the
 * key with `dictionaryKeySchema`. Nothing connected those two paths, so a module could ship a key
 * its own API rejects — the seeded tenant worked, and a tenant that never ran that seed hit a
 * validation failure on first use, with the feature simply unavailable.
 *
 * This audit closes the gap statically: every dictionary key literal declared anywhere in the
 * product must satisfy the schema the create route enforces. Pinning the known keys instead would
 * pass while the next module reintroduced the same mismatch.
 *
 * Scope is derived from a glob over every package's module tree plus the app and template module
 * roots, so a new package is covered without editing this file. A declaration counts when its
 * name carries `DICTIONARY_KEY`, `DICTIONARY_KEYS` or a `_DICTIONARIES` suffix — the naming every
 * current declaration site already uses — and the key literals are read out of the four shapes
 * those declarations take: a bare string, an array of strings, a map of strings, and a map of
 * descriptor objects carrying a `key` property.
 */

const repoRoot = join(__dirname, '..', '..', '..', '..')

const SCAN_GLOBS = [
  'packages/*/src/modules/**/*.{ts,tsx}',
  'apps/mercato/src/modules/**/*.{ts,tsx}',
  'packages/create-app/template/src/modules/**/*.{ts,tsx}',
]

const DECLARATION_NAME = /(?:DICTIONARY_KEYS?|_DICTIONARIES)$/

type KeyDeclaration = {
  file: string
  constant: string
  key: string
}

function readStringLiteral(node: ts.Node): string | null {
  return ts.isStringLiteralLike(node) ? node.text : null
}

function collectKeysFromInitializer(initializer: ts.Expression): string[] {
  const unwrapped = ts.isAsExpression(initializer) ? initializer.expression : initializer

  const literal = readStringLiteral(unwrapped)
  if (literal !== null) return [literal]

  if (ts.isArrayLiteralExpression(unwrapped)) {
    return unwrapped.elements.map(readStringLiteral).filter((value): value is string => value !== null)
  }

  if (ts.isObjectLiteralExpression(unwrapped)) {
    const keys: string[] = []
    for (const property of unwrapped.properties) {
      if (!ts.isPropertyAssignment(property)) continue
      const value = ts.isAsExpression(property.initializer) ? property.initializer.expression : property.initializer
      const direct = readStringLiteral(value)
      if (direct !== null) {
        keys.push(direct)
        continue
      }
      if (!ts.isObjectLiteralExpression(value)) continue
      for (const nested of value.properties) {
        if (!ts.isPropertyAssignment(nested)) continue
        if (nested.name.getText() !== 'key') continue
        const nestedKey = readStringLiteral(nested.initializer)
        if (nestedKey !== null) keys.push(nestedKey)
      }
    }
    return keys
  }

  return []
}

function collectDeclarations(file: string): KeyDeclaration[] {
  const source = readFileSync(join(repoRoot, file), 'utf8')
  if (!/(?:DICTIONARY_KEYS?|_DICTIONARIES)\b/.test(source)) return []

  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found: KeyDeclaration[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const constant = node.name.text
      if (DECLARATION_NAME.test(constant)) {
        for (const key of collectKeysFromInitializer(node.initializer)) {
          found.push({ file, constant, key })
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(parsed)
  return found
}

const declarations = fg
  .sync(SCAN_GLOBS, { cwd: repoRoot, ignore: ['**/node_modules/**', '**/__tests__/**', '**/__integration__/**'] })
  .sort()
  .flatMap(collectDeclarations)

describe('dictionary keys declared by modules', () => {
  it('finds the declaration sites to audit', () => {
    expect(declarations.length).toBeGreaterThan(10)
  })

  it('every declared key satisfies the schema the create route enforces', () => {
    const rejected = declarations
      .filter((declaration) => !dictionaryKeySchema.safeParse(declaration.key).success)
      .map((declaration) => `${relative('.', declaration.file)} — ${declaration.constant} = "${declaration.key}"`)

    expect(rejected).toEqual([])
  })

  it('covers the planner unavailability reason keys', () => {
    const plannerKeys = declarations
      .filter((declaration) => declaration.constant === 'UNAVAILABILITY_REASON_DICTIONARIES')
      .map((declaration) => declaration.key)

    expect(plannerKeys).toHaveLength(3)
  })
})
