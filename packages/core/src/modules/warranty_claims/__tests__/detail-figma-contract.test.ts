import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const detailSource = readFileSync(join(__dirname, '../backend/warranty_claims/[id]/page.tsx'), 'utf8')
const workspaceSource = readFileSync(join(__dirname, '../backend/components/WarrantyWorkspace.tsx'), 'utf8')

describe('warranty claim detail Figma hierarchy', () => {
  it('keeps the stage, tabs, totals, and line table in the designed order', () => {
    const stage = detailSource.indexOf('<ClaimStageProgress')
    const tabs = detailSource.indexOf('tabs.map((tab)')
    const totals = detailSource.indexOf("t('warranty_claims.detail.totalClaimed')")
    const table = detailSource.indexOf('<DataTable<ClaimLine>')

    expect(stage).toBeGreaterThan(-1)
    expect(tabs).toBeGreaterThan(stage)
    expect(totals).toBeGreaterThan(tabs)
    expect(table).toBeGreaterThan(totals)
  })

  it('keeps the Figma header actions and renders priority as plain text', () => {
    expect(detailSource).toContain('<Trash2')
    expect(detailSource).toContain('<ActionsDropdown')
    expect(detailSource).toContain("t('warranty_claims.edit.fulfillment.resolution')")
    expect(detailSource).not.toContain('ClaimPriorityBadge')
  })

  it('uses the accessible tab primitive and awaits clipboard writes before success feedback', () => {
    expect(detailSource).toContain("from '@open-mercato/ui/primitives/tabs'")
    expect(detailSource).toContain('<TabsList')
    expect(detailSource).toContain('<TabsTrigger')
    expect(detailSource).toContain('<TabsContent')
    expect(detailSource).toContain('await navigator.clipboard.writeText')
    expect(detailSource).toContain("warranty_claims.detail.copyFailed")
  })

  it('wraps localized risk badges and leaves room below horizontally scrollable list tabs', () => {
    expect(detailSource).toContain('h-auto max-w-full whitespace-normal break-words text-left leading-snug')
    expect(workspaceSource).toContain('overflow-x-auto px-7 pb-2')
  })
})
