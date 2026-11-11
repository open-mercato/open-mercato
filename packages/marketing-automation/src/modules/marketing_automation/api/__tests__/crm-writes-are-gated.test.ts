import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A write to another module's records must be gated by that module's grant.
 *
 * `marketing_automation.*` says what somebody may do with campaigns. Tagging a customer is a write to
 * the CRM, and core's own route for that single write requires `customers.activities.manage` — so
 * accepting a marketing feature alone made the bulk form over ten thousand people easier to reach than
 * tagging one person by hand. A permission boundary that holds for one record and not for the set is
 * not a boundary.
 *
 * Written after exactly that: the segment bulk action reached `customers.tags.assign` under
 * `marketing_automation.campaigns.manage` alone.
 *
 * Two rules, because the write is split over two files. The ROUTE decides — inline rather than declared,
 * since which grant applies depends on the action named in the body (`add_points` writes this module's
 * own ledger and no CRM row). The WORKER carries out that decision, so what it must not do is look like
 * a write nobody authorised.
 */
const MODULE_ROOT = join(__dirname, '..', '..')
const CRM_WRITE_COMMAND = 'customers.tags.assign'
const CRM_WRITE_FEATURE = 'customers.activities.manage'

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (entry === '__tests__' || entry === '__integration__' || entry === 'node_modules') return []
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return entry.endsWith('.ts') || entry.endsWith('.tsx') ? [path] : []
  })
}

/**
 * Comments are stripped before anything is matched.
 *
 * The first version of the rule below asked whether the file mentioned `systemActor`, and the comment
 * explaining the rule mentioned it — so the rule passed on its own prose and could not fail. A structural
 * guard that cannot fail reports a clean module for ever.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

const files = sourceFiles(MODULE_ROOT).map((path) => ({
  path,
  source: readFileSync(path, 'utf8'),
  code: withoutComments(readFileSync(path, 'utf8')),
}))
const callers = files.filter(({ source }) => source.includes(`'${CRM_WRITE_COMMAND}'`))

describe(`writes through ${CRM_WRITE_COMMAND}`, () => {
  it('finds the files it is meant to be guarding', () => {
    // A rename that empties this list would turn the suite into a silent pass.
    expect(callers.length).toBeGreaterThan(0)
  })

  /**
   * `auth: null` with no `systemActor` is indistinguishable from a write nobody authorised, which is the
   * one shape a command bus should be suspicious of. The module has `buildCampaignCommandContext` for
   * this, and it sets the flag.
   */
  for (const { path, code } of callers) {
    const name = path.slice(path.indexOf('/marketing_automation/') + '/marketing_automation/'.length)
    it(`${name} does not hand-write an anonymous command context`, () => {
      /**
       * The invariant is the absence of a hand-written context, not the presence of a particular call.
       * `steps/add-tag.ts` legitimately uses the one the dispatcher built for the run
       * (`deps.commandContext`) and never names the builder; what must not appear is `auth: null` spelled
       * out here, because that is how `systemActor` goes missing beside it.
       */
      expect(/auth:\s*null/.test(code)).toBe(false)
    })
  }

  it('the route that can start it checks the CRM grant', () => {
    const actionsRoute = files.find(({ path }) => path.endsWith(join('segments', '[id]', 'actions', 'route.ts')))
    expect(actionsRoute).toBeDefined()
    const source = actionsRoute?.code ?? ''
    expect(source.includes(`'${CRM_WRITE_FEATURE}'`)).toBe(true)
    expect(source.includes('userHasAllFeatures')).toBe(true)
    // Decided per action: declaring it in the metadata would refuse `add_points` for the same caller.
    expect(/requireFeatures:\s*\[[^\]]*'customers\.activities\.manage'/.test(source)).toBe(false)
  })
})
