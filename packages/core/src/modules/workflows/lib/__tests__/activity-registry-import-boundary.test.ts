/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guards the Activity Registry purity boundary (spec
 * 2026-07-26-workflows-ux-redesign.md section 3.2).
 *
 * The registry must stay loadable from both the UI bundle and the async
 * worker, so it may never value-import React, MikroORM, or Awilix at module
 * scope — type-only imports are the sanctioned way to reference
 * EntityManager, AwilixContainer, and ActivityContext.
 */

const registrySource = readFileSync(join(__dirname, '..', 'activity-registry.ts'), 'utf8')

// Extract whole import statements (this codebase omits semicolons, so anchor
// each statement to a line-leading `import` and stop at its `from '...'`).
const importStatements = (src: string): string[] =>
  src.match(/^import\b[\s\S]*?from\s+['"][^'"]+['"]/gm) ?? []

const forbiddenValueImports = (src: string, modulePattern: RegExp): string[] =>
  importStatements(src).filter(
    (statement) =>
      modulePattern.test(statement) && !/^import\s+type\b/.test(statement),
  )

describe('activity-registry purity boundary', () => {
  test.each([
    ['react', /from\s+['"]react(?:-dom)?(?:\/[^'"]*)?['"]/],
    ['@mikro-orm', /from\s+['"]@mikro-orm\/[^'"]+['"]/],
    ['awilix', /from\s+['"]awilix['"]/],
  ])('has no value-imports of %s', (_moduleName, modulePattern) => {
    expect(forbiddenValueImports(registrySource, modulePattern)).toEqual([])
  })

  test('references the execution environment through type-only imports', () => {
    const typeOnlyImports = importStatements(registrySource).filter((statement) =>
      /^import\s+type\b/.test(statement),
    )
    expect(typeOnlyImports.some((statement) => /@mikro-orm\/postgresql/.test(statement))).toBe(true)
    expect(typeOnlyImports.some((statement) => /['"]awilix['"]/.test(statement))).toBe(true)
    expect(typeOnlyImports.some((statement) => /\.\/activity-executor/.test(statement))).toBe(true)
  })
})
