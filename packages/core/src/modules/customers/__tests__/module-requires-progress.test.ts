import fs from 'node:fs'
import path from 'node:path'

import { metadata } from '../index'

const moduleRoot = path.join(__dirname, '..')

describe('customers module dependency on progress', () => {
  // The deal bulk-update-owner/stage workers and lib/bulkDeals.ts resolve
  // `progressService` from the DI container, which is only registered when the
  // `progress` module is enabled. Without a declared `requires` entry, an app
  // that enables `customers` without `progress` (e.g. the `wms` starter preset)
  // gets no build-time error — the worker instead fails silently on every retry
  // (#6302, same class as #6094). This test guards the fix: the declaration
  // must stay in sync with the DI dependency it protects.
  it('declares progress as a required module', () => {
    expect(metadata.requires).toContain('progress')
  })

  it('still resolves progressService from the DI container in the deal bulk-update workers and lib', () => {
    const resolvesProgressService = /resolve(?:<[^>]*>)?\(\s*['"]progressService['"]\s*\)/
    const bulkDealsSource = fs.readFileSync(path.join(moduleRoot, 'lib', 'bulkDeals.ts'), 'utf8')
    const ownerWorkerSource = fs.readFileSync(
      path.join(moduleRoot, 'workers', 'deals-bulk-update-owner.ts'),
      'utf8',
    )
    const stageWorkerSource = fs.readFileSync(
      path.join(moduleRoot, 'workers', 'deals-bulk-update-stage.ts'),
      'utf8',
    )
    expect(bulkDealsSource).toMatch(resolvesProgressService)
    expect(ownerWorkerSource).toMatch(resolvesProgressService)
    expect(stageWorkerSource).toMatch(resolvesProgressService)
  })
})
