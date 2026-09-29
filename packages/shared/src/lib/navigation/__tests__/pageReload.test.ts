/**
 * These helpers exist so a boundary-crossing portal navigation re-runs the server layout that
 * computes the portal chrome and the session. Which document API each one uses is the whole
 * contract: `assign` keeps the current page in session history, `replace` does not, so they are
 * the document-loading counterparts of `router.push` and `router.replace` respectively. Swapping
 * one for the other is invisible on screen and only surfaces as a broken Back button, so pin both.
 *
 * This runs in the node environment on purpose: jsdom exposes `window.location` as a
 * non-configurable getter whose `assign`/`replace` are non-writable, so the real navigation calls
 * cannot be observed there. A synthetic `window` lets the helper bodies run for real.
 */

const assign = jest.fn()
const replace = jest.fn()

describe('page reload navigation helpers', () => {
  let navigateWithPageReload: (path: string) => void
  let replaceWithPageReload: (path: string) => void

  beforeAll(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: { location: { assign, replace } },
    })
    // Imported after the synthetic window exists, so the module resolves against it.
    const helpers = require('../pageReload')
    navigateWithPageReload = helpers.navigateWithPageReload
    replaceWithPageReload = helpers.replaceWithPageReload
  })

  afterAll(() => {
    delete (globalThis as { window?: unknown }).window
  })

  beforeEach(() => {
    assign.mockReset()
    replace.mockReset()
  })

  describe('navigateWithPageReload', () => {
    it('loads the path and keeps the current page in session history', () => {
      navigateWithPageReload('/acme/portal/dashboard')

      expect(assign).toHaveBeenCalledWith('/acme/portal/dashboard')
      expect(replace).not.toHaveBeenCalled()
    })
  })

  describe('replaceWithPageReload', () => {
    it('loads the path without leaving the redirecting page in session history', () => {
      replaceWithPageReload('/acme/portal/login')

      expect(replace).toHaveBeenCalledWith('/acme/portal/login')
      expect(assign).not.toHaveBeenCalled()
    })
  })
})
