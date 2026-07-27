import type { Module, BackendRouteManifestEntry } from '../../../modules/registry'
import { getBackendRouteManifests } from '../../../modules/registry'
import { getModules } from '../registry'
import { getModuleSurfaceFingerprint } from '../surfaceFingerprint'

jest.mock('../registry', () => ({
  getModules: jest.fn(),
}))

jest.mock('../../../modules/registry', () => ({
  getBackendRouteManifests: jest.fn(),
}))

const mockGetModules = jest.mocked(getModules)
const mockGetBackendRouteManifests = jest.mocked(getBackendRouteManifests)

function route(pattern: string, overrides: Partial<BackendRouteManifestEntry> = {}): BackendRouteManifestEntry {
  return {
    moduleId: 'auth',
    pattern,
    title: 'Page',
    load: async () => null,
    ...overrides,
  } as BackendRouteManifestEntry
}

function setSurface(moduleIds: string[], routes: BackendRouteManifestEntry[]): void {
  mockGetModules.mockReturnValue(moduleIds.map((id) => ({ id }) as Module))
  mockGetBackendRouteManifests.mockReturnValue(routes)
}

describe('getModuleSurfaceFingerprint', () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  it('is stable for the same enabled modules and route manifest', () => {
    setSurface(['auth', 'search'], [route('/backend/dashboard')])
    const first = getModuleSurfaceFingerprint()

    setSurface(['auth', 'search'], [route('/backend/dashboard')])
    expect(getModuleSurfaceFingerprint()).toBe(first)
  })

  it('changes when a module is enabled — the deploy that used to serve a stale nav', () => {
    setSurface(['auth'], [route('/backend/dashboard')])
    const before = getModuleSurfaceFingerprint()

    setSurface(['auth', 'search'], [route('/backend/dashboard')])
    expect(getModuleSurfaceFingerprint()).not.toBe(before)
  })

  it('changes when a backend route is added', () => {
    setSurface(['auth'], [route('/backend/dashboard')])
    const before = getModuleSurfaceFingerprint()

    setSurface(['auth'], [route('/backend/dashboard'), route('/backend/search')])
    expect(getModuleSurfaceFingerprint()).not.toBe(before)
  })

  it('changes when only a route metadata field changes', () => {
    setSurface(['auth'], [route('/backend/dashboard', { title: 'Dashboard' })])
    const before = getModuleSurfaceFingerprint()

    setSurface(['auth'], [route('/backend/dashboard', { title: 'Overview' })])
    expect(getModuleSurfaceFingerprint()).not.toBe(before)
  })

  it('ignores route manifest ordering', () => {
    setSurface(['auth'], [route('/backend/a'), route('/backend/b')])
    const forward = getModuleSurfaceFingerprint()

    setSurface(['auth'], [route('/backend/b'), route('/backend/a')])
    expect(getModuleSurfaceFingerprint()).toBe(forward)
  })

  it('falls back to the route manifest alone when the module registry is not populated', () => {
    mockGetModules.mockImplementation(() => {
      throw new Error('[Bootstrap] Modules not registered.')
    })
    mockGetBackendRouteManifests.mockReturnValue([route('/backend/dashboard')])

    expect(getModuleSurfaceFingerprint()).toMatch(/^[0-9a-f]{12}$/)
  })
})
