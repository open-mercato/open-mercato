import { keyValuePropsSchema } from '@open-mercato/ui/blocks/contracts/key-value'
import { timelinePropsSchema } from '@open-mercato/ui/blocks/contracts/timeline'
import { buildPropsTable, type PropRow } from '../props-table'
import { contractForEntry } from '../contracts'

function rowByName(rows: PropRow[], name: string): PropRow {
  const row = rows.find((candidate) => candidate.name === name)
  if (!row) throw new Error(`[internal] missing row ${name}`)
  return row
}

describe('buildPropsTable', () => {
  const timelineRows = buildPropsTable(timelinePropsSchema)
  const keyValueRows = buildPropsTable(keyValuePropsSchema)

  it('lists Timeline top-level props with required flags', () => {
    expect(rowByName(timelineRows, 'items')).toMatchObject({ required: true, kind: 'prop', type: 'object[]', depth: 0 })
    expect(rowByName(timelineRows, 'order')).toMatchObject({ required: true, type: "'desc' | 'asc'" })
    expect(rowByName(timelineRows, 'groupBy')).toMatchObject({ required: false, type: "'day' | 'none'" })
    expect(rowByName(timelineRows, 'hasMore')).toMatchObject({ required: false, type: 'boolean' })
  })

  it('reads slot and event kinds from the schema meta', () => {
    expect(rowByName(timelineRows, 'onItemAction')).toMatchObject({ kind: 'event', type: 'function', required: false })
    expect(rowByName(timelineRows, 'onLoadMore')).toMatchObject({ kind: 'event' })
    expect(rowByName(timelineRows, 'header')).toMatchObject({ kind: 'slot', type: 'ReactNode' })
    expect(rowByName(timelineRows, 'emptyState')).toMatchObject({ kind: 'slot' })
  })

  it('expands nested item fields', () => {
    expect(rowByName(timelineRows, 'items[].occurredAt')).toMatchObject({ required: true, depth: 1, type: 'string (ISO date-time)' })
    expect(rowByName(timelineRows, 'items[].body')).toMatchObject({ required: false, kind: 'slot' })
    expect(rowByName(timelineRows, 'items[].status.tone')).toMatchObject({
      depth: 2,
      type: "'neutral' | 'info' | 'success' | 'warning' | 'error'",
    })
  })

  it('handles KeyValue items, editors and literal unions', () => {
    expect(rowByName(keyValueRows, 'items[].value')).toMatchObject({ kind: 'slot', required: true })
    expect(rowByName(keyValueRows, 'items[].editor')).toMatchObject({ type: "'text' | 'textarea' | 'select' | 'date'", required: false })
    expect(rowByName(keyValueRows, 'columns').type).toBe('1 | 2')
    expect(rowByName(keyValueRows, 'onEdit')).toMatchObject({ kind: 'event' })
    expect(rowByName(keyValueRows, 'footer')).toMatchObject({ kind: 'slot' })
  })

  it('keeps rows unique and ordered by declaration', () => {
    const names = timelineRows.map((row) => row.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names.indexOf('status')).toBeLessThan(names.indexOf('items'))
  })
})

describe('contractForEntry', () => {
  it('maps block entry ids to their contracts', () => {
    expect(contractForEntry('timeline')?.file).toBe('packages/ui/src/blocks/contracts/timeline.ts')
    expect(contractForEntry('key-value')?.rows.length).toBeGreaterThan(0)
  })

  it('returns null for entries without a documented contract', () => {
    expect(contractForEntry('button')).toBeNull()
  })
})
