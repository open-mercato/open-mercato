import { SCOPED_HISTORY_COLUMNS, buildHistoryColumns } from '../HistoryListTableColumns'

describe('HistoryListTableColumns', () => {
  const columns = buildHistoryColumns((key) => key)

  it('builds the history columns in order', () => {
    expect(columns.map((column) => column.id)).toEqual([
      'resource',
      'templateLabel',
      'generatedAt',
      'format',
      'generatedBy',
      'resourceKind',
      'resourceId',
      'templateId',
      'templateVersion',
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

describe('generated-by column', () => {
  it('shows the resolved user name and falls back to the user id', () => {
    const column = buildHistoryColumns((key) => key, ['generatedBy'], { 'user-1': 'Ada Admin' })[0] as unknown as {
      cell: (input: { row: { original: { generatedBy: string } } }) => unknown
    }
    expect(column.cell({ row: { original: { generatedBy: 'user-1' } } })).toBe('Ada Admin')
    expect(column.cell({ row: { original: { generatedBy: 'user-2' } } })).toBe('user-2')
  })
})
