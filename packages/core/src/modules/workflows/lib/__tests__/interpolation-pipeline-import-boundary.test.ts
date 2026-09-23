/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guards the interpolation-pipeline purity boundary (spec
 * 2026-07-26-workflows-ux-redesign.md section 3.6, Phase 2b).
 *
 * The pipeline parser and transform table must stay computable in the browser
 * bundle (pill editing, Problems panel) and in the runtime engine without
 * dragging in React, MikroORM, Awilix, the activity registry, or the Zod
 * validators. It is fully dependency-free — no value imports at all.
 */

const pipelineSource = readFileSync(join(__dirname, '..', 'interpolation-pipeline.ts'), 'utf8')

const importStatements = (src: string): string[] =>
  src.match(/^import\b[\s\S]*?from\s+['"][^'"]+['"]/gm) ?? []

const valueImportSpecifiers = (src: string): string[] =>
  importStatements(src)
    .filter((statement) => !/^import\s+type\b/.test(statement))
    .map((statement) => statement.match(/from\s+['"]([^'"]+)['"]/)?.[1] ?? statement)

describe('interpolation-pipeline purity boundary', () => {
  test('has no value imports at all', () => {
    expect(valueImportSpecifiers(pipelineSource)).toEqual([])
  })

  test.each([
    ['react', /from\s+['"]react(?:-dom)?(?:\/[^'"]*)?['"]/],
    ['@mikro-orm', /from\s+['"]@mikro-orm\/[^'"]+['"]/],
    ['awilix', /from\s+['"]awilix['"]/],
    ['zod', /from\s+['"]zod['"]/],
    ['the activity registry', /from\s+['"]\.\/activity-registry[^'"]*['"]/],
    ['the activity executor', /from\s+['"]\.\/activity-executor['"]/],
    ['the data validators', /from\s+['"]\.\.\/data\/validators['"]/],
  ])('never imports %s (even as a type)', (_moduleName, modulePattern) => {
    expect(importStatements(pipelineSource).filter((statement) => modulePattern.test(statement))).toEqual([])
  })
})
