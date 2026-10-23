import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The sweep must ask the cheap questions first.
 *
 * `subjectGuardsAllow` needs a customer's id. `buildSubjectDocument` issues eleven queries to describe them.
 * Every guard in the first rejects people the second was about to describe for nothing — and on a mature
 * campaign under a `once` policy, the already-enrolled are most of the population.
 *
 * Asserted against the SOURCE because the ordering is the whole optimisation and it is invisible in any
 * result: swap the two lines and every test still passes, every campaign still behaves identically, and the
 * sweep quietly costs an order of magnitude more. This module already guards a queue-name literal the same
 * way, for the same reason.
 */
describe('the sweep guards before it projects', () => {
  const source = readFileSync(join(__dirname, '..', 'sweep.ts'), 'utf8')

  const orderingIn = (functionName: string): { guardAt: number; buildAt: number } => {
    const start = source.indexOf(`async function ${functionName}(`)
    expect(start).toBeGreaterThan(-1)
    // Bounded by the next top-level declaration so a later function cannot satisfy the assertion.
    const after = source.indexOf('\nasync function ', start + 1)
    const body = source.slice(start, after === -1 ? undefined : after)
    return {
      guardAt: body.indexOf('subjectGuardsAllow('),
      buildAt: body.indexOf('buildSubjectDocument('),
    }
  }

  for (const functionName of ['startForCandidate', 'startRowCandidate']) {
    test(`${functionName} calls the id-only guards first`, () => {
      const { guardAt, buildAt } = orderingIn(functionName)
      expect(guardAt).toBeGreaterThan(-1)
      expect(buildAt).toBeGreaterThan(-1)
      expect(guardAt).toBeLessThan(buildAt)
    })
  }

  test('the guards still read nothing but an id', () => {
    const dispatcher = readFileSync(join(__dirname, '..', '..', 'lib', 'dispatcher.ts'), 'utf8')
    const start = dispatcher.indexOf('export async function subjectGuardsAllow(')
    expect(start).toBeGreaterThan(-1)
    const body = dispatcher.slice(start, dispatcher.indexOf('\nexport async function startCampaignForSubject(', start))
    // A guard that reaches for the subject document would put the projection back on the critical path and
    // silently undo the reordering above.
    expect(body).not.toContain('input.subject')
    expect(body).not.toContain('buildSubjectDocument')
  })
})
