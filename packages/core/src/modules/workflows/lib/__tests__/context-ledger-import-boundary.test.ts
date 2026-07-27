/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guards the context-ledger purity boundary (spec
 * 2026-07-26-workflows-ux-redesign.md section 3.1).
 *
 * The ledger must stay computable in the browser bundle and in server routes
 * without dragging in React, MikroORM, Awilix, the activity registry, or the
 * Zod validators (whose import freezes the activity-type enum). Its only
 * sanctioned value import is the pure `./set-variable` helper module;
 * output-contract resolution is an injected seam, never an import.
 */

const ledgerSource = readFileSync(join(__dirname, '..', 'context-ledger.ts'), 'utf8')

const importStatements = (src: string): string[] =>
  src.match(/^import\b[\s\S]*?from\s+['"][^'"]+['"]/gm) ?? []

const valueImportSpecifiers = (src: string): string[] =>
  importStatements(src)
    .filter((statement) => !/^import\s+type\b/.test(statement))
    .map((statement) => statement.match(/from\s+['"]([^'"]+)['"]/)?.[1] ?? statement)

describe('context-ledger purity boundary', () => {
  test('only value-imports the pure set-variable helper module', () => {
    expect(valueImportSpecifiers(ledgerSource)).toEqual(['./set-variable'])
  })

  test.each([
    ['react', /from\s+['"]react(?:-dom)?(?:\/[^'"]*)?['"]/],
    ['@mikro-orm', /from\s+['"]@mikro-orm\/[^'"]+['"]/],
    ['awilix', /from\s+['"]awilix['"]/],
    ['zod', /from\s+['"]zod['"]/],
    ['the activity registry', /from\s+['"]\.\/activity-registry[^'"]*['"]/],
    ['the data validators', /from\s+['"]\.\.\/data\/validators['"]/],
  ])('never imports %s (even as a type)', (_moduleName, modulePattern) => {
    expect(importStatements(ledgerSource).filter((statement) => modulePattern.test(statement))).toEqual([])
  })
})
