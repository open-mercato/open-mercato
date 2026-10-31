import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import * as aov from '../../aov-kpi/config'
import * as customers from '../../new-customers-kpi/config'
import * as statuses from '../../orders-by-status/config'
import * as orders from '../../orders-kpi/config'
import * as revenue from '../config'
import * as trend from '../../revenue-trend/config'
import * as regions from '../../sales-by-region/config'
import * as topCustomers from '../../top-customers/config'
import * as products from '../../top-products/config'

function legacySettings<Settings extends { dateRangeMode?: 'global' | 'custom' }>(settings: Settings): Omit<Settings, 'dateRangeMode'> {
  const { dateRangeMode: _mode, ...legacy } = settings
  return legacy
}

const legacyInputs = [
  legacySettings(aov.DEFAULT_SETTINGS) satisfies aov.AovKpiSettings,
  legacySettings(customers.DEFAULT_SETTINGS) satisfies customers.NewCustomersKpiSettings,
  legacySettings(statuses.DEFAULT_SETTINGS) satisfies statuses.OrdersByStatusSettings,
  legacySettings(orders.DEFAULT_SETTINGS) satisfies orders.OrdersKpiSettings,
  legacySettings(revenue.DEFAULT_SETTINGS) satisfies revenue.RevenueKpiSettings,
  legacySettings(trend.DEFAULT_SETTINGS) satisfies trend.RevenueTrendSettings,
  legacySettings(regions.DEFAULT_SETTINGS) satisfies regions.SalesByRegionSettings,
  legacySettings(topCustomers.DEFAULT_SETTINGS) satisfies topCustomers.TopCustomersSettings,
  legacySettings(products.DEFAULT_SETTINGS) satisfies products.TopProductsSettings,
]

describe('legacy analytics settings input contract', () => {
  test('typechecks every legacy settings input without the new date-range mode', () => {
    const packageRoot = resolve(__dirname, '../../../../../../..')
    const directory = mkdtempSync(join(tmpdir(), 'dashboard-settings-contract-'))
    const configPath = join(directory, 'tsconfig.json')
    writeFileSync(configPath, JSON.stringify({
      extends: join(packageRoot, 'tsconfig.json'),
      compilerOptions: { incremental: false, types: ['jest', 'node', 'react'] },
      include: [__filename],
      exclude: [],
    }))
    try {
      const compiler = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc')
      const result = spawnSync(process.execPath, [compiler, '--project', configPath], { cwd: packageRoot, encoding: 'utf8' })

      expect(legacyInputs).toHaveLength(9)
      expect(result.error).toBeUndefined()
      expect({ status: result.status, output: result.stdout + result.stderr }).toEqual({ status: 0, output: '' })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
