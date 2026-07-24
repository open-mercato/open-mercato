import { buildEntitiesCsv, type EntitiesExportRow } from '../entitiesCsvExport'

describe('buildEntitiesCsv (entities Export CSV formula neutralization)', () => {
  it('neutralizes spreadsheet formula prefixes in user-controllable entityId/label cells', () => {
    const rows: EntitiesExportRow[] = [
      { entityId: '=cmd|\'/c calc\'!A1', label: '@SUM(A1:A2)', source: 'custom', count: 3, showInSidebar: true },
      { entityId: 'normal_entity', label: '+1+1', source: 'custom', count: 1, showInSidebar: false },
    ]

    const csv = buildEntitiesCsv(rows, { includeSidebar: true })
    const lines = csv.split('\n')

    expect(lines[0]).toBe('entityId,label,source,count,showInSidebar')
    // Dangerous leading tokens are prefixed with a single apostrophe so spreadsheets treat them as text.
    expect(lines[1]).toBe('\'=cmd|\'/c calc\'!A1,\'@SUM(A1:A2),custom,3,true')
    // Ordinary text passes through untouched; genuine leading-token label is neutralized.
    expect(lines[2]).toBe('normal_entity,\'+1+1,custom,1,false')
  })

  it('neutralizes leading TAB/CR control characters that spreadsheets strip before formula parsing', () => {
    const rows: EntitiesExportRow[] = [
      { entityId: '\t=HYPERLINK("https://example.invalid")', label: '\r-2+3', source: 'custom', count: 0 },
    ]

    const csv = buildEntitiesCsv(rows)
    const lines = csv.split('\n')

    expect(lines[0]).toBe('entityId,label,source,count')
    // Both cells start with a control char + formula token, so each is quoted and apostrophe-prefixed.
    expect(lines[1]).toBe('"\'\t=HYPERLINK(""https://example.invalid"")","\'\r-2+3",custom,0')
  })

  it('leaves the showInSidebar column out unless requested (system entities export)', () => {
    const rows: EntitiesExportRow[] = [
      { entityId: 'sales:order', label: 'Order', source: 'code', count: 12 },
    ]

    const csv = buildEntitiesCsv(rows)

    expect(csv).toBe(['entityId,label,source,count', 'sales:order,Order,code,12'].join('\n'))
  })
})
