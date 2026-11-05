import { withDataTableNamespaces } from '../DataTable'

describe('withDataTableNamespaces', () => {
  it('preserves mapped row fields and appends namespaced payload fields', () => {
    const row = { id: '1', name: 'Alice' }
    const source = {
      id: '1',
      name: 'Alice',
      _example: { priority: 'high' },
      _other: { flag: true },
      ignored: 'value',
    }

    expect(withDataTableNamespaces(row, source)).toEqual({
      id: '1',
      name: 'Alice',
      _example: { priority: 'high' },
      _other: { flag: true },
    })
  })

  it('does not overwrite mapped values with non-namespaced source fields', () => {
    const row = { id: '1', status: 'mapped' }
    const source = { id: '1', status: 'source', plain: 123 }

    expect(withDataTableNamespaces(row, source)).toEqual({
      id: '1',
      status: 'mapped',
    })
  })
})

