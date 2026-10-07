/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import fs from 'node:fs'
import path from 'node:path'
import { features as workflowsFeatures } from '../acl'

/**
 * Every `requireFeatures` guard in this module MUST name a feature `acl.ts`
 * actually declares.
 *
 * A guard on an undeclared id is invisible in review and silent at runtime: a
 * wildcard grant (`workflows.*`, `*`) still matches it, so administrators see
 * the page work, while anyone granted the real feature through a concrete role
 * is locked out with no error to trace. Both instance pages guarded on
 * `workflows.view_instances` and the create bridge on `workflows.create` — ids
 * that never existed — for exactly that reason.
 */

const MODULE_ROOT = path.join(__dirname, '..')
const SKIPPED_DIRECTORIES = new Set(['__tests__', '__integration__', 'node_modules', 'migrations'])
const GUARD_PATTERN = /requireFeatures\s*:\s*\[([^\]]*)\]/g
const FEATURE_ID_PATTERN = /['"]([^'"]+)['"]/g

function collectSourceFiles(directory: string, collected: string[] = []): string[] {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue
      collectSourceFiles(path.join(directory, entry.name), collected)
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue
    if (/\.test\.(ts|tsx)$/.test(entry.name)) continue
    collected.push(path.join(directory, entry.name))
  }
  return collected
}

interface FeatureGuard {
  file: string
  featureId: string
}

function collectFeatureGuards(): FeatureGuard[] {
  const guards: FeatureGuard[] = []
  for (const file of collectSourceFiles(MODULE_ROOT)) {
    const source = fs.readFileSync(file, 'utf8')
    for (const guardMatch of source.matchAll(GUARD_PATTERN)) {
      for (const idMatch of guardMatch[1].matchAll(FEATURE_ID_PATTERN)) {
        guards.push({ file: path.relative(MODULE_ROOT, file), featureId: idMatch[1] })
      }
    }
  }
  return guards
}

const declaredFeatureIds = new Set(workflowsFeatures.map((feature) => feature.id))

describe('workflows requireFeatures guards', () => {
  const guards = collectFeatureGuards()

  test('finds the guards it is meant to police', () => {
    expect(guards.length).toBeGreaterThan(20)
    expect(guards.map((guard) => guard.file)).toEqual(
      expect.arrayContaining([
        path.join('backend', 'instances', 'page.meta.ts'),
        path.join('backend', 'instances', '[id]', 'page.meta.ts'),
        path.join('api', 'instances', 'route.ts'),
      ]),
    )
  })

  test('every guarded feature id is declared in acl.ts', () => {
    const undeclared = guards.filter((guard) => !declaredFeatureIds.has(guard.featureId))
    expect(undeclared).toEqual([])
  })

  test('every guard stays inside the workflows namespace', () => {
    const foreign = guards.filter((guard) => !guard.featureId.startsWith('workflows.'))
    expect(foreign).toEqual([])
  })

  test('the instance pages guard on the id employees are actually granted', () => {
    const instanceGuards = guards.filter((guard) =>
      guard.file.startsWith(path.join('backend', 'instances')),
    )
    // The list, the detail and the failure-queue triage page. The count is
    // asserted as a floor rather than an exact number so adding a page cannot
    // fail this test for the wrong reason — the invariant is the FEATURE ID
    // every one of them guards on, not how many there are.
    expect(instanceGuards.length).toBeGreaterThanOrEqual(3)
    for (const guard of instanceGuards) {
      expect(guard.featureId).toBe('workflows.instances.view')
    }
  })
})
