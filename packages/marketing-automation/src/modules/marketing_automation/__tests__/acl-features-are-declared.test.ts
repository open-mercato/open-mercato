import fs from 'node:fs'
import path from 'node:path'
import { features } from '../acl'

/**
 * Every feature id a route or page guards on must be DECLARED in `acl.ts`.
 *
 * Two real bugs made this necessary. `marketing_automation.manage` was never declared, so it fell closed and
 * could only be satisfied by the seeded admin's `marketing_automation.*` wildcard — a permission nobody could be
 * granted deliberately. And `marketing_automation.campaigns.test_dispatch` was never declared either, which is
 * worse: feature matching is by PREFIX, so a `marketing_automation.campaigns.*` grant satisfied it while never
 * satisfying the declared `marketing_automation.test_dispatch`, handing the send-level trust to the authoring
 * level. Neither is visible to typechecking, so the guard has to be a test.
 */
const MODULE_ROOT = path.resolve(__dirname, '..')
const DECLARED = new Set(features.map((feature) => feature.id))
const REQUIRE_FEATURES = /requireFeatures:\s*\[([^\]]*)\]/g
const OWN_FEATURE = /'(marketing_automation\.[a-z0-9_.]+)'/g

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules' || entry.name === 'migrations') return []
      return sourceFiles(full)
    }
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

describe('ACL feature ids', () => {
  const offenders: Array<{ file: string; feature: string }> = []

  beforeAll(() => {
    for (const file of sourceFiles(MODULE_ROOT)) {
      const source = fs.readFileSync(file, 'utf8')
      for (const guard of source.matchAll(REQUIRE_FEATURES)) {
        for (const match of guard[1].matchAll(OWN_FEATURE)) {
          if (!DECLARED.has(match[1])) offenders.push({ file: path.relative(MODULE_ROOT, file), feature: match[1] })
        }
      }
    }
  })

  test('every guarded feature of this module is declared in acl.ts', () => {
    expect(offenders).toEqual([])
  })

  test('acl.ts keeps the send level separate from the authoring level', () => {
    // The separation the module documents: authoring a campaign is not permission to send a message.
    expect(DECLARED.has('marketing_automation.campaigns.manage')).toBe(true)
    expect(DECLARED.has('marketing_automation.test_dispatch')).toBe(true)
    // And the send level must NOT live under `campaigns.`, or a `campaigns.*` grant would include it by prefix.
    expect([...DECLARED].filter((id) => id.startsWith('marketing_automation.campaigns.') && id.includes('dispatch'))).toEqual([])
  })
})
