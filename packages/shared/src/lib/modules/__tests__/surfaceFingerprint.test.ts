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

type ModuleSurface = string | { id: string; features: Array<{ id: string; module?: string }> }

function setSurface(modules: ModuleSurface[], routes: BackendRouteManifestEntry[]): void {
  mockGetModules.mockReturnValue(modules.map((mod) => (typeof mod === 'string' ? { id: mod } : mod) as Module))
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

  it('changes when a module declares a new feature and no route moves', () => {
    const routes = [route('/backend/dashboard')]
    setSurface([{ id: 'auth', features: [{ id: 'auth.view' }] }], routes)
    const before = getModuleSurfaceFingerprint()

    setSurface([{ id: 'auth', features: [{ id: 'auth.view' }, { id: 'auth.manage' }] }], routes)
    expect(getModuleSurfaceFingerprint()).not.toBe(before)
  })

  it('changes when a feature declares a different owning module', () => {
    const routes = [route('/backend/dashboard')]
    setSurface([{ id: 'auth', features: [{ id: 'analytics.view' }] }], routes)
    const before = getModuleSurfaceFingerprint()

    setSurface([{ id: 'auth', features: [{ id: 'analytics.view', module: 'reporting' }] }], routes)
    expect(getModuleSurfaceFingerprint()).not.toBe(before)
  })

  it('ignores feature ordering within a module', () => {
    const routes = [route('/backend/dashboard')]
    setSurface([{ id: 'auth', features: [{ id: 'auth.view' }, { id: 'auth.manage' }] }], routes)
    const forward = getModuleSurfaceFingerprint()

    setSurface([{ id: 'auth', features: [{ id: 'auth.manage' }, { id: 'auth.view' }] }], routes)
    expect(getModuleSurfaceFingerprint()).toBe(forward)
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

  it('degrades to a constant rather than throwing when route metadata cannot be serialized', () => {
    const circular = route('/backend/dashboard') as BackendRouteManifestEntry & { self?: unknown }
    circular.self = circular
    setSurface(['auth'], [circular])

    expect(getModuleSurfaceFingerprint()).toBe('unknown')
  })
})
