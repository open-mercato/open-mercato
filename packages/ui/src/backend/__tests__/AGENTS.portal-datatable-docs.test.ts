import * as fs from 'fs'
import * as path from 'path'

const AGENTS_MD_PATH = path.resolve(__dirname, '..', '..', '..', 'AGENTS.md')

describe('packages/ui/AGENTS.md — portal DataTable documentation (issue #1827)', () => {
  let contents: string

  beforeAll(() => {
    contents = fs.readFileSync(AGENTS_MD_PATH, 'utf8')
  })

  it('documents that DataTable can be used in portal pages', () => {
    expect(contents).toMatch(/Using DataTable in Portal Pages/)
  })

  it('cross-references the portal section to the DataTable usage block', () => {
    const portalSectionStart = contents.indexOf('## Portal Extension')
    expect(portalSectionStart).toBeGreaterThan(-1)
    const portalSection = contents.slice(portalSectionStart, portalSectionStart + 1500)
    expect(portalSection).toMatch(/DataTable/)
    expect(portalSection).toMatch(/portal-safe/i)
  })

  it('lists the backoffice-only props that portal pages should omit', () => {
    const backofficeOnlyProps = ['exporter', 'perspective', 'advancedFilter', 'columnChooser']
    for (const prop of backofficeOnlyProps) {
      expect(contents).toMatch(new RegExp(`\`${prop}\``))
    }
  })

  it('lists the portal-safe props', () => {
    const portalSafeMentions = ['columns', 'data', 'isLoading', 'onRowClick', 'pagination', 'rowActions']
    for (const prop of portalSafeMentions) {
      expect(contents).toMatch(new RegExp(`\`${prop}\``))
    }
  })

  it('includes a minimal portal usage example importing DataTable from @open-mercato/ui', () => {
    expect(contents).toMatch(/import \{ DataTable \} from '@open-mercato\/ui'/)
  })

  it('does not introduce any portal example that activates backoffice-only features', () => {
    const usingPortalIndex = contents.indexOf('Using DataTable in Portal Pages')
    expect(usingPortalIndex).toBeGreaterThan(-1)
    const nextSectionIndex = contents.indexOf('## CrudForm Field Injection', usingPortalIndex)
    expect(nextSectionIndex).toBeGreaterThan(usingPortalIndex)
    const portalUsageBlock = contents.slice(usingPortalIndex, nextSectionIndex)
    const portalCodeFenceMatch = portalUsageBlock.match(/```tsx[\s\S]*?```/)
    expect(portalCodeFenceMatch).not.toBeNull()
    const portalCodeFence = portalCodeFenceMatch![0]
    expect(portalCodeFence).not.toMatch(/exporter=/)
    expect(portalCodeFence).not.toMatch(/perspective=/)
    expect(portalCodeFence).not.toMatch(/advancedFilter=/)
    expect(portalCodeFence).not.toMatch(/columnChooser=/)
    expect(portalCodeFence).not.toMatch(/injectionSpotId=/)
    expect(portalCodeFence).not.toMatch(/replacementHandle=/)
  })
})
