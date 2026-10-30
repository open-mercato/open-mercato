import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A staff route with no resolvable organization answers 400, never 401.
 *
 * Not a style point. `apiFetch` reads 401 as an expired session: it refreshes, the refresh SUCCEEDS because
 * the session was always valid, it returns to the same page, and the page asks again — so answering 401 for
 * "All organizations" did not fail, it looped for ever, and the screen showed nothing while the network tab
 * filled up. Forty-six guards in this module did it.
 *
 * The resolver also recovers the actor's own organization when the effective tenant is still the actor's own,
 * which is what keeps a super-admin's configuration visible rather than unreachable.
 */
const API_ROOT = join(__dirname, '..')

/**
 * The one route that may answer 401 for a missing organization.
 *
 * A portal session carries the customer's own organization and there is no scope to select, so an absent one
 * means the session is unusable rather than unscoped.
 */
const CUSTOMER_SESSION_ROUTES = [join('portal', 'preferences', 'route.ts')]

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (entry === '__tests__') return []
    if (statSync(path).isDirectory()) return routeFiles(path)
    return entry === 'route.ts' ? [path] : []
  })
}

describe('organization scope', () => {
  /**
   * Comments are stripped before anything is matched.
   *
   * The first version of the second rule below flagged the portal route, because the comment explaining why
   * that route is exempt names `organizationScopeRequiredResponse`. A guard that reads prose reports whatever
   * the prose says.
   */
  const routes = routeFiles(API_ROOT).map((path) => {
    const source = readFileSync(path, 'utf8')
    return {
      relative: path.slice(API_ROOT.length + 1),
      source,
      code: source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''),
    }
  })

  it('finds the routes it is meant to be guarding', () => {
    expect(routes.length).toBeGreaterThan(40)
  })

  it('no staff route refuses a missing organization with a 401', () => {
    const offenders = routes
      .filter(({ relative }) => !CUSTOMER_SESSION_ROUTES.includes(relative))
      .filter(({ code }) => /!auth\??\.orgId/.test(code))
      .map(({ relative }) => relative)
    expect(offenders).toEqual([])
  })

  it('every route that needs an organization resolves one through the shared helper', () => {
    const offenders = routes
      .filter(({ code }) => code.includes('organizationScopeRequiredResponse'))
      .filter(({ code }) => !code.includes('resolveActiveOrganizationId('))
      .map(({ relative }) => relative)
    expect(offenders).toEqual([])
  })

  it('the exempt route is the portal one, and it still exists', () => {
    // A rename that empties this list would quietly widen the exemption.
    for (const relative of CUSTOMER_SESSION_ROUTES) {
      const route = routes.find((candidate) => candidate.relative === relative)
      expect(route).toBeDefined()
      expect(route?.source).toContain('getCustomerAuthFromRequest')
    }
  })
})
