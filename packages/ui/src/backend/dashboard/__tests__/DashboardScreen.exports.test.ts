import { DashboardScreen, DashboardScreenLegacy, DashboardScreenV2 } from '@open-mercato/ui/backend/dashboard'
import { DashboardScreen as DeepDashboardScreen } from '../DashboardScreen'

describe('dashboard export surface', () => {
  it('exports DashboardScreen as the v2 implementation and keeps the legacy escape hatch', () => {
    expect(DashboardScreen).toBe(DashboardScreenV2)
    expect(DeepDashboardScreen).toBe(DashboardScreenV2)
    expect(DashboardScreenLegacy).toBeDefined()
  })
})
