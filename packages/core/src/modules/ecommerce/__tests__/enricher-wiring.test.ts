import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { enrichers } from '../data/enrichers'

/**
 * A response enricher only runs on a CRUD route that opts in with `enrichers: { entityId }`.
 * Every enricher this module declares for one of its own entities must therefore be wired into
 * that entity's `makeCrudRoute`, or the enriched fields silently never reach the client.
 */

const apiRoot = join(__dirname, '..', 'api')
const OPT_IN_PATTERN = /enrichers:\s*\{\s*entityId:\s*E\.ecommerce\.(\w+)\s*\}/g

function collectApiSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue
      collectApiSources(full, out)
      continue
    }
    if (entry.endsWith('.ts')) out.push(full)
  }
  return out
}

function optedInEntityKeys(): Set<string> {
  const keys = new Set<string>()
  for (const file of collectApiSources(apiRoot)) {
    for (const match of readFileSync(file, 'utf8').matchAll(OPT_IN_PATTERN)) keys.add(match[1])
  }
  return keys
}

describe('ecommerce response enricher wiring', () => {
  const ownEnrichers = enrichers.filter((enricher) => enricher.targetEntity.startsWith('ecommerce:'))

  it('declares at least one enricher for an ecommerce entity', () => {
    expect(ownEnrichers.length).toBeGreaterThan(0)
  })

  it.each(ownEnrichers.map((enricher) => [enricher.id, enricher.targetEntity]))(
    '%s is opted into the CRUD route of %s',
    (_id, targetEntity) => {
      const entityKey = targetEntity.slice('ecommerce:'.length)
      expect(optedInEntityKeys()).toContain(entityKey)
    },
  )
})
