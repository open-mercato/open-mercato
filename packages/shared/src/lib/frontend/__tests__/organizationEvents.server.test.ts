/**
 * The SERVER half of the organization-scope seed. The browser half, and the full
 * story of what the seed fixes, is in `organizationEvents.test.ts`; this file
 * exists separately only because the invariant it pins is "there is no DOM", which
 * is jest's `node` environment (this package's default) and cannot be expressed in
 * the same file as a jsdom suite.
 *
 * WHAT IS PINNED. The seed reads `document.cookie`, and it runs at MODULE
 * INITIALISATION rather than lazily from the readers — so on the server it runs
 * during import, in a module instance shared across every request. Two things must
 * hold there, and until now only a code comment claimed them:
 *
 *   1. no `document` -> no seed, so the scope stays `{ null, null }`. One request's
 *      organization must never become the module's idea of the scope.
 *   2. no `window` -> `emitOrganizationScopeChanged` returns before it touches
 *      `currentScope` or `currentVersion`, which is what makes (1) durable if
 *      server code ever calls it.
 *
 * Seeding at module initialisation is what makes this worth asserting: a lazy seed
 * could only ever fire from a call site, an eager one fires on import, so "import
 * on the server is inert" became a real precondition rather than a theoretical one.
 *
 * It is also the public-export half of the change. `getCurrentOrganizationScope()`
 * used to return `{ null, null }` until the first announcement and now returns the
 * cookie scope on the client, so `useOrganizationScopeDetail()`'s lazy initializer
 * differs between the SSR pass and hydration. This file pins the SSR side of that
 * pair; `organizationEvents.test.ts` pins the hydration side.
 */
import type * as OrganizationEvents from '../organizationEvents'

type ScopeModule = typeof OrganizationEvents

const ORG = 'f21494dd-9918-45e6-9e0c-2f21fffadff7'
const TENANT = '44def49d-b3d5-4124-81df-72587e604861'

/** A module instance imported the way a server render imports it: with no DOM. */
function loadOnServer(): ScopeModule {
  let mod!: ScopeModule
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../organizationEvents') as ScopeModule
  })
  return mod
}

describe('organization scope version: the server-side module stays inert', () => {
  it('really runs without a DOM, so the assertions below mean what they say', () => {
    // If this file ever acquires a `@jest-environment jsdom` docblock, every other
    // assertion here would still pass while testing nothing.
    expect(typeof document).toBe('undefined')
    expect(typeof window).toBe('undefined')
  })

  it('does not seed the scope when the module initialises without a document', () => {
    const scope = loadOnServer()

    expect(scope.getCurrentOrganizationScope()).toEqual({ organizationId: null, tenantId: null })
    expect(scope.getCurrentOrganizationScopeVersion()).toBe(0)
  })

  it('does not adopt an announced scope without a window, so requests cannot bleed together', () => {
    const scope = loadOnServer()

    scope.emitOrganizationScopeChanged({ organizationId: ORG, tenantId: TENANT })

    expect(scope.getCurrentOrganizationScope()).toEqual({ organizationId: null, tenantId: null })
    expect(scope.getCurrentOrganizationScopeVersion()).toBe(0)
  })
})
