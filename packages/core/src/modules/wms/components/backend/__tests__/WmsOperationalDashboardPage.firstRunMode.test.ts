import { resolveDashboardFirstRunMode } from '../WmsOperationalDashboardPage'

describe('resolveDashboardFirstRunMode', () => {
  const base = {
    warehousesLoading: false,
    warehousesError: false,
    hasWarehouses: true,
    locationsLoading: false,
    locationsError: false,
    locationsCount: 5,
  }

  it('returns null while warehouses are loading', () => {
    expect(resolveDashboardFirstRunMode({ ...base, warehousesLoading: true })).toBeNull()
  })

  it('returns null when warehouses failed to load', () => {
    expect(resolveDashboardFirstRunMode({ ...base, warehousesError: true })).toBeNull()
  })

  it('returns no-warehouses when there are no warehouses', () => {
    expect(resolveDashboardFirstRunMode({ ...base, hasWarehouses: false })).toBe('no-warehouses')
  })

  it('returns null while locations are loading, even with warehouses present', () => {
    expect(resolveDashboardFirstRunMode({ ...base, locationsLoading: true })).toBeNull()
  })

  it('returns null when locations failed to load', () => {
    expect(resolveDashboardFirstRunMode({ ...base, locationsError: true })).toBeNull()
  })

  it('returns no-locations when warehouses exist but no locations are configured', () => {
    expect(resolveDashboardFirstRunMode({ ...base, locationsCount: 0 })).toBe('no-locations')
  })

  it('returns null when both warehouses and locations are configured', () => {
    expect(resolveDashboardFirstRunMode(base)).toBeNull()
  })

  it('prioritizes no-warehouses over the locations count when both are missing', () => {
    expect(
      resolveDashboardFirstRunMode({ ...base, hasWarehouses: false, locationsCount: 0 }),
    ).toBe('no-warehouses')
  })
})
