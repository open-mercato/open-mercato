import { SCOPED_HISTORY_COLUMNS, buildHistoryColumns } from '../HistoryListTableColumns'

describe('HistoryListTableColumns', () => {
  const columns = buildHistoryColumns((key) => key)

  it('builds the nine history columns in order', () => {
    expect(columns.map((column) => column.id)).toEqual([
      'resource',
      'templateLabel',
      'generatedAt',
      'format',
      'generatedBy',
      'resourceKind',
      'resourceId',
      'templateId',
      'id',
    ])
  })

  it('allows sorting only on the four allowlisted columns', () => {
    const sortable = columns.filter((column) => column.enableSorting === true).map((column) => column.id)
    expect(sortable).toEqual(['templateLabel', 'generatedAt', 'format', 'generatedBy'])
    expect(columns.find((column) => column.id === 'resource')?.enableSorting).toBe(false)
  })

  it('selects the scoped subset in canonical order', () => {
    expect(SCOPED_HISTORY_COLUMNS).toEqual(['templateLabel', 'format', 'generatedBy', 'generatedAt'])
    expect(buildHistoryColumns((key) => key, SCOPED_HISTORY_COLUMNS).map((column) => column.id)).toEqual([
      'templateLabel',
      'generatedAt',
      'format',
      'generatedBy',
    ])
  })
})
