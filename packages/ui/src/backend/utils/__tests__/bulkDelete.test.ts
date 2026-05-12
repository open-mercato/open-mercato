import { groupBulkDeleteFailures, runBulkDelete, type BulkDeleteFailure } from '../bulkDelete'

describe('runBulkDelete', () => {
  it('captures error message and code from thrown error', async () => {
    const dependencyErr = Object.assign(new Error('Cannot delete company: linked deals (2).'), {
      code: 'COMPANY_HAS_DEPENDENTS',
      status: 422,
    })
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const deleteOne = jest.fn().mockImplementation(async (row: { id: string }) => {
      if (row.id === 'b') throw dependencyErr
    })

    const { succeeded, failures } = await runBulkDelete(rows, deleteOne)

    expect(succeeded).toEqual([{ id: 'a' }, { id: 'c' }])
    expect(failures).toEqual([
      { id: 'b', code: 'COMPANY_HAS_DEPENDENTS', message: 'Cannot delete company: linked deals (2).' },
    ])
  })

  it('falls back to fallbackErrorMessage when the error has no message', async () => {
    const empty = Object.assign(new Error(''), {})
    const deleteOne = jest.fn().mockRejectedValue(empty)

    const { failures } = await runBulkDelete([{ id: 'x' }], deleteOne, {
      fallbackErrorMessage: 'Failed to delete record.',
    })

    expect(failures[0]).toEqual({ id: 'x', code: null, message: 'Failed to delete record.' })
  })

  it('treats non-string code as null', async () => {
    const err = Object.assign(new Error('boom'), { code: 500 })
    const deleteOne = jest.fn().mockRejectedValue(err)

    const { failures } = await runBulkDelete([{ id: 'x' }], deleteOne)

    expect(failures[0].code).toBeNull()
  })

  it('logs failures via console.warn when logTag is provided', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const err = Object.assign(new Error('linked deals (2).'), { code: 'COMPANY_HAS_DEPENDENTS' })
      const deleteOne = jest.fn().mockRejectedValue(err)

      await runBulkDelete([{ id: 'x' }], deleteOne, { logTag: 'customers.companies.list' })

      expect(warnSpy).toHaveBeenCalledTimes(1)
      const [tag, payload] = warnSpy.mock.calls[0]
      expect(tag).toBe('[customers.companies.list] bulk delete failed')
      expect(payload).toMatchObject({ id: 'x', code: 'COMPANY_HAS_DEPENDENTS' })
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('does not log when logTag is omitted', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const deleteOne = jest.fn().mockRejectedValue(new Error('boom'))
      await runBulkDelete([{ id: 'x' }], deleteOne)
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe('groupBulkDeleteFailures', () => {
  it('groups failures by error code and counts occurrences', () => {
    const failures: BulkDeleteFailure[] = [
      { id: '1', code: 'HAS_DEPENDENTS', message: 'Cannot delete (a)' },
      { id: '2', code: 'HAS_DEPENDENTS', message: 'Cannot delete (b)' },
      { id: '3', code: 'OTHER_ERROR', message: 'Different' },
    ]

    const groups = groupBulkDeleteFailures(failures)

    expect(groups).toHaveLength(2)
    const dependents = groups.find((g) => g.key === 'HAS_DEPENDENTS')!
    expect(dependents.count).toBe(2)
    expect(dependents.ids).toEqual(['1', '2'])
    expect(dependents.sampleMessage).toBe('Cannot delete (a)')
  })

  it('falls back to message when no code is present', () => {
    const failures: BulkDeleteFailure[] = [
      { id: '1', code: null, message: 'Same reason' },
      { id: '2', code: null, message: 'Same reason' },
      { id: '3', code: null, message: 'Different reason' },
    ]

    const groups = groupBulkDeleteFailures(failures)

    expect(groups.map((g) => g.count).sort()).toEqual([1, 2])
  })

  it('returns empty array when no failures', () => {
    expect(groupBulkDeleteFailures([])).toEqual([])
  })
})
