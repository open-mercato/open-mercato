import {
  FIRST_TASK_SEQUENCE_NUMBER,
  TASK_REFERENCE_FALLBACK_CODE,
  allocateTaskReference,
  formatTaskReference,
  nextTaskSequenceNumber,
  normalizeProjectCodeForReference,
  withTaskReferenceRetry,
} from '../taskReference'

class FakeUniqueViolation extends Error {
  code = '23505'
}

const isFakeConflict = (err: unknown) => err instanceof FakeUniqueViolation

describe('task reference formatting', () => {
  it('renders <project code>-<sequence number>', () => {
    expect(formatTaskReference('TT', 142)).toBe('TT-142')
  })

  it('falls back to a usable code so a task is always numbered', () => {
    expect(normalizeProjectCodeForReference('  ')).toBe(TASK_REFERENCE_FALLBACK_CODE)
    expect(formatTaskReference(null, 1)).toBe(`${TASK_REFERENCE_FALLBACK_CODE}-1`)
  })

  it('starts a fresh project at one', () => {
    expect(nextTaskSequenceNumber(null)).toBe(FIRST_TASK_SEQUENCE_NUMBER)
    expect(nextTaskSequenceNumber(0)).toBe(1)
    expect(nextTaskSequenceNumber(141)).toBe(142)
  })

  it('allocates from the highest live number the attempt just read', () => {
    expect(allocateTaskReference('TT', 141)).toEqual({ sequenceNumber: 142, reference: 'TT-142' })
  })
})

describe('withTaskReferenceRetry', () => {
  it('returns the first attempt that wins the number', async () => {
    const runAttempt = jest.fn().mockResolvedValue('created')
    await expect(withTaskReferenceRetry(runAttempt)).resolves.toBe('created')
    expect(runAttempt).toHaveBeenCalledTimes(1)
  })

  it('retries a lost race and reports the attempt index', async () => {
    const runAttempt = jest.fn(async (attempt: number) => {
      if (attempt === 0) throw new FakeUniqueViolation('duplicate key')
      return attempt
    })

    await expect(withTaskReferenceRetry(runAttempt, { isConflict: isFakeConflict })).resolves.toBe(1)
    expect(runAttempt).toHaveBeenCalledTimes(2)
  })

  it('rethrows anything that is not a lost race without retrying', async () => {
    const runAttempt = jest.fn().mockRejectedValue(new Error('[internal] boom'))

    await expect(withTaskReferenceRetry(runAttempt, { isConflict: isFakeConflict })).rejects.toThrow('boom')
    expect(runAttempt).toHaveBeenCalledTimes(1)
  })

  it('gives up after the attempt budget and surfaces the conflict', async () => {
    const runAttempt = jest.fn().mockRejectedValue(new FakeUniqueViolation('duplicate key'))

    await expect(
      withTaskReferenceRetry(runAttempt, { maxAttempts: 3, isConflict: isFakeConflict }),
    ).rejects.toBeInstanceOf(FakeUniqueViolation)
    expect(runAttempt).toHaveBeenCalledTimes(3)
  })
})

describe('concurrent creates on one project', () => {
  /**
   * Stands in for the partial unique index: a second row claiming a taken
   * `(project, sequence_number)` pair is rejected, exactly as postgres would.
   */
  function makeProjectTable(code: string) {
    const rows: { sequenceNumber: number; reference: string; title: string }[] = []
    return {
      rows,
      readHighest: () => rows.reduce((highest, row) => Math.max(highest, row.sequenceNumber), 0),
      insert(allocation: { sequenceNumber: number; reference: string }, title: string) {
        if (rows.some((row) => row.sequenceNumber === allocation.sequenceNumber)) {
          throw new FakeUniqueViolation('duplicate key value violates unique constraint')
        }
        rows.push({ ...allocation, title })
      },
      allocate: (highest: number) => allocateTaskReference(code, highest),
    }
  }

  it('hands two simultaneous creates two different references', async () => {
    const table = makeProjectTable('TT')
    table.insert(table.allocate(0), 'existing')

    // Both attempts read the same max before either writes — the collision the
    // index has to catch. The loser retries and reads the winner's row.
    const firstRead = table.readHighest()
    const secondRead = table.readHighest()

    const first = await withTaskReferenceRetry(
      async (attempt) => {
        const allocation = table.allocate(attempt === 0 ? firstRead : table.readHighest())
        table.insert(allocation, 'first')
        return allocation
      },
      { isConflict: isFakeConflict },
    )
    const second = await withTaskReferenceRetry(
      async (attempt) => {
        const allocation = table.allocate(attempt === 0 ? secondRead : table.readHighest())
        table.insert(allocation, 'second')
        return allocation
      },
      { isConflict: isFakeConflict },
    )

    expect(first.reference).toBe('TT-2')
    expect(second.reference).toBe('TT-3')
    expect(new Set(table.rows.map((row) => row.reference)).size).toBe(table.rows.length)
  })
})
