import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'backend', 'WmsLocationDetailPage.tsx'),
  'utf8',
)

describe('WMS location inventory selection accessibility', () => {
  it('distinguishes the select-all checkbox from row selection controls', () => {
    expect(source).toContain(
      "aria-label={t('wms.backend.location.items.columns.selectAll', 'Select all items')}",
    )
  })

  it('includes the row SKU in each selection checkbox name', () => {
    expect(source).toMatch(
      /aria-label=\{t\('wms\.backend\.location\.items\.columns\.selectNamed', 'Select \{item\}', \{\s*item: formatSkuLabel\(row\.original\),/,
    )
  })
})
