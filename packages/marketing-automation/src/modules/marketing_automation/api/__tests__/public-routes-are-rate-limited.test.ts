import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every unauthenticated route in this module takes a rate limit.
 *
 * All six were unlimited. The cost is not symmetrical, which is why the postures differ: an inbound POST
 * spends a bounded decrypt scan, a track/open writes a row, and a GET confirmation page writes nothing at
 * all. What they share is that the URL is in somebody's mailbox and the caller is nobody in particular.
 *
 * The tracking pair is deliberately FAIL-OPEN and limits the write rather than the response: those endpoints
 * live in messages already delivered, which cannot be fixed afterwards, so a 429 would break a sent email to
 * protect a statistics table. The two POSTs that change something and the inbound hook are fail-closed,
 * where an unenforced limit is worse than a rejected request.
 */
const API_ROOT = join(__dirname, '..')

/** The public routes, and what each one's posture has to be. */
const PUBLIC_ROUTES: Array<{ path: string; posture: 'fail-open' | 'fail-closed' }> = [
  { path: join('track', 'open', 'route.ts'), posture: 'fail-open' },
  { path: join('track', 'click', 'route.ts'), posture: 'fail-open' },
  { path: join('unsubscribe', 'route.ts'), posture: 'fail-closed' },
  { path: join('survey', 'route.ts'), posture: 'fail-closed' },
  { path: join('inbound', 'route.ts'), posture: 'fail-closed' },
]

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (entry === '__tests__') return []
    if (statSync(path).isDirectory()) return routeFiles(path)
    return entry === 'route.ts' ? [path] : []
  })
}

describe('the public routes', () => {
  /**
   * The list above is the contract. A new public route — one with no `requireAuth` and no customer session —
   * has to be added here with a posture chosen deliberately, rather than shipping unlimited because nobody
   * remembered.
   */
  it('is exactly the set this rule knows about', () => {
    const unauthenticated = routeFiles(API_ROOT).filter((path) => {
      const source = readFileSync(path, 'utf8')
      if (/requireAuth:\s*true/.test(source)) return false
      if (source.includes('getCustomerAuthFromRequest')) return false
      return /export async function (GET|POST)/.test(source)
    })
    const relative = unauthenticated.map((path) => path.slice(API_ROOT.length + 1)).sort()
    /**
     * The routes this delivery CONTAINS, not the whole catalogue.
     *
     * `PUBLIC_ROUTES` is the module's complete list and a partial delivery holds a subset, so comparing against
     * all of it fails for the right reason in the wrong place. Comparing against the ones present keeps the real
     * assertion — that no public route exists which this list has forgotten — which is the direction that
     * matters: a new unlisted public endpoint still fails here.
     */
    const expected = PUBLIC_ROUTES.map((route) => route.path).filter((path) => relative.includes(path)).sort()
    expect(relative).toEqual(expected)
    /**
     * Where this delivery contains none, that is asserted against an INDEPENDENT definition rather than waved
     * through: a public route is precisely one whose metadata does not require auth, so if the list is empty
     * every route here must require it. A delivery that gains a public endpoint without adding it to
     * `PUBLIC_ROUTES` therefore still fails, which is the whole point of the rule.
     */
    if (relative.length === 0) {
      const unauthenticated = routeFiles(API_ROOT).filter(
        (path) => !/requireAuth:\s*true/.test(readFileSync(path, 'utf8')),
      )
      expect(unauthenticated).toEqual([])
    }
  })

  // Only the ones this delivery contains, for the reason the finder control above states.
  for (const { path, posture } of PUBLIC_ROUTES.filter((route) => existsSync(join(API_ROOT, route.path)))) {
    const source = readFileSync(join(API_ROOT, path), 'utf8')

    it(`${path} enforces a limit`, () => {
      expect(source).toContain('enforceMarketingRateLimit(')
    })

    it(`${path} is ${posture}`, () => {
      expect(source).toContain(`posture: '${posture}'`)
    })

    it(`${path} keys on the credential, not the address alone`, () => {
      // One hook being hammered must not exhaust another's quota, and a NAT must not punish a whole office.
      expect(/credential:\s*(token|new URL)/.test(source)).toBe(true)
    })
  }
})
