import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import * as ts from 'typescript'
import fg from 'fast-glob'
import { dictionaryKeySchema } from '@open-mercato/core/modules/dictionaries/data/validators'

/**
 * Dictionary key coverage guard.
 *
 * Every dictionary key literal declared anywhere in the product must satisfy the schema the
 * create route enforces (`dictionaryKeySchema`), so a module can never ship a key its own API
 * would reject. Pinning the known keys instead would pass while the next module reintroduced
 * the same mismatch.
 *
 * Scope is derived from a glob over every package's module tree plus the app and template module
 * roots, so a new package is covered without editing this file. A declaration counts under one of
 * three rules: its name ends in `DICTIONARY_KEY`, `DICTIONARY_KEYS` or `_DICTIONARIES` (unambiguous
 * naming); its name ends in `DEFINITIONS` and its type annotation mentions "dictionary" (the
 * `DEFINITIONS` suffix alone is too generic — other modules use it for unrelated descriptor maps);
 * or, regardless of the enclosing declaration's name, any descriptor object carries a
 * `dictionaryKey` property, since that property name is unambiguous on its own. Key literals are
 * read out of five shapes: a bare string, an array of strings, an array of descriptor objects, a
 * map of strings, and a map of descriptor objects — a descriptor object's key lives in either a
 * `key` property (only honored under the first two rules) or a `dictionaryKey` property (always
 * honored).
 */

const repoRoot = join(__dirname, '..', '..', '..', '..')

const SCAN_GLOBS = [
  'packages/*/src/modules/**/*.{ts,tsx}',
  'apps/mercato/src/modules/**/*.{ts,tsx}',
  'packages/create-app/template/src/modules/**/*.{ts,tsx}',
]

const UNAMBIGUOUS_DECLARATION_NAME = /(?:DICTIONARY_KEYS?|_DICTIONARIES)$/
const AMBIGUOUS_DECLARATION_NAME = /DEFINITIONS$/

type KeyDeclaration = {
  file: string
  constant: string
  key: string
}

function readStringLiteral(node: ts.Node): string | null {
  return ts.isStringLiteralLike(node) ? node.text : null
}

function readDescriptorKey(value: ts.Expression, includeAmbiguousKey: boolean): string | null {
  if (!ts.isObjectLiteralExpression(value)) return null
  for (const property of value.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    const name = property.name.getText()
    if (name !== 'dictionaryKey' && !(includeAmbiguousKey && name === 'key')) continue
    const literal = readStringLiteral(property.initializer)
    if (literal !== null) return literal
  }
  return null
}

function collectKeysFromInitializer(initializer: ts.Expression, includeBareLiterals: boolean): string[] {
  const unwrapped = ts.isAsExpression(initializer) ? initializer.expression : initializer

  if (includeBareLiterals) {
    const literal = readStringLiteral(unwrapped)
    if (literal !== null) return [literal]
  }

  if (ts.isArrayLiteralExpression(unwrapped)) {
    const keys: string[] = []
    for (const element of unwrapped.elements) {
      if (includeBareLiterals) {
        const direct = readStringLiteral(element)
        if (direct !== null) {
          keys.push(direct)
          continue
        }
      }
      const descriptorKey = readDescriptorKey(element, includeBareLiterals)
      if (descriptorKey !== null) keys.push(descriptorKey)
    }
    return keys
  }

  if (ts.isObjectLiteralExpression(unwrapped)) {
    const keys: string[] = []
    for (const property of unwrapped.properties) {
      if (!ts.isPropertyAssignment(property)) continue
      const value = ts.isAsExpression(property.initializer) ? property.initializer.expression : property.initializer
      if (includeBareLiterals) {
        const direct = readStringLiteral(value)
        if (direct !== null) {
          keys.push(direct)
          continue
        }
      }
      const descriptorKey = readDescriptorKey(value, includeBareLiterals)
      if (descriptorKey !== null) keys.push(descriptorKey)
    }
    return keys
  }

  return []
}

function collectDeclarations(file: string): KeyDeclaration[] {
  const source = readFileSync(join(repoRoot, file), 'utf8')
  if (!/(?:DICTIONARY_KEYS?|_DICTIONARIES|DEFINITIONS|dictionaryKey)\b/.test(source)) return []

  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found: KeyDeclaration[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const constant = node.name.text
      const isUnambiguous = UNAMBIGUOUS_DECLARATION_NAME.test(constant)
      const isAmbiguousDictionary =
        AMBIGUOUS_DECLARATION_NAME.test(constant) && node.type !== undefined && /dictionary/i.test(node.type.getText())
      const includeBareLiterals = isUnambiguous || isAmbiguousDictionary
      for (const key of collectKeysFromInitializer(node.initializer, includeBareLiterals)) {
        found.push({ file, constant, key })
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
    expect(declarations.length).toBeGreaterThan(20)
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

  it('covers the sales dictionary definitions', () => {
    const salesKeys = declarations
      .filter((declaration) => declaration.constant === 'DEFINITIONS' && declaration.file.includes('modules/sales/'))
      .map((declaration) => declaration.key)
      .sort()

    expect(salesKeys).toEqual(
      [
        'sales.adjustment_kind',
        'sales.deal_loss_reason',
        'sales.order_line_status',
        'sales.order_status',
        'sales.payment_status',
        'sales.shipment_status',
      ].sort(),
    )
  })
})
