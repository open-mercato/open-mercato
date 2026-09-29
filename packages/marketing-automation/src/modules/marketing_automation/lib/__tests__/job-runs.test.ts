import { recordJobRun } from '../job-runs'

/**
 * The recorder around a job, and the two properties that matter: it never breaks the job it describes, and
 * a failure is recorded AND re-thrown.
 */

type Row = Record<string, unknown>

/**
 * A fake that models the ONE behaviour this file got wrong: an entity manager writes a managed entity's
 * changes on flush, and a cleared manager writes nothing. So `create` hands back a staging object distinct
 * from the stored row, `flush` copies one into the other while the row is still managed, and `clear` stops
 * that — which is exactly how a completion written through the managed entity disappeared.
 */
function fakeEm(options: { failCreate?: boolean; failFlush?: boolean; failUpdate?: boolean } = {}) {
  const rows: Row[] = []
  const staged: Array<{ row: Row; draft: Row; managed: boolean }> = []
  let next = 0
  return {
    rows,
    create(_entity: unknown, data: Row) {
      if (options.failCreate) throw new Error('[internal] insert refused')
      next += 1
      const id = `job-${next}`
      const row: Row = { id, ...data }
      rows.push(row)
      const draft: Row = { id, ...data }
      staged.push({ row, draft, managed: true })
      return draft
    },
    persist() { /* the fake keeps everything in `rows` */ },
    async flush() {
      if (options.failFlush) throw new Error('[internal] flush refused')
      for (const entry of staged) {
        if (entry.managed) Object.assign(entry.row, entry.draft)
      }
    },
    /**
     * The terminal status is written by id, not through the managed entity — see the docblock on
     * `recordJobRun`. A write by id reaches the row whether or not anything is still managed.
     */
    async nativeUpdate(_entity: unknown, where: Row, data: Row) {
      if (options.failUpdate) throw new Error('[internal] update refused')
      const row = rows.find((candidate) => candidate.id === where.id)
      if (!row) return 0
      Object.assign(row, data)
      return 1
    },
    /** What a job legitimately does to recover from a unique violation. Everything becomes detached. */
    clear() {
      for (const entry of staged) entry.managed = false
    },
  }
}

const scope = { tenantId: 't', organizationId: 'o' }

describe('recordJobRun', () => {
  it('records the start before the work runs, so a crashed job leaves a trace', async () => {
    const em = fakeEm()
    let statusDuringWork: unknown = null
    await recordJobRun(em as never, scope, { kind: 'sweep', campaignId: 'c1' }, async () => {
      statusDuringWork = em.rows[0]?.status
      return { counters: { started: 3 } }
    })
    expect(statusDuringWork).toBe('running')
    expect(em.rows[0]).toMatchObject({ kind: 'sweep', campaignId: 'c1', status: 'ok', counters: { started: 3 } })
    expect(em.rows[0].finishedAt).toBeInstanceOf(Date)
  })

  it('records a failure and re-throws it, because a failed job must stay failed', async () => {
    const em = fakeEm()
    await expect(recordJobRun(em as never, scope, { kind: 'due_runs' }, async () => {
      throw new Error('[internal] the sweep exploded')
    })).rejects.toThrow('the sweep exploded')
    expect(em.rows[0]).toMatchObject({ status: 'failed' })
    expect(em.rows[0].error).toContain('exploded')
  })

  it('runs the work even when the log row cannot be written', async () => {
    const em = fakeEm({ failCreate: true })
    const result = await recordJobRun(em as never, scope, { kind: 'sweep' }, async () => ({ counters: { started: 1 } }))
    // Bookkeeping never breaks the job it describes.
    expect(result).toEqual({ counters: { started: 1 } })
  })

  it('returns the work result even when the completion write fails', async () => {
    const em = fakeEm({ failUpdate: true })
    const result = await recordJobRun(em as never, scope, { kind: 'sweep' }, async () => ({ counters: { started: 2 } }))
    expect(result).toEqual({ counters: { started: 2 } })
  })

  it('still re-throws the work error when the failure write also fails', async () => {
    const em = fakeEm({ failUpdate: true })
    await expect(recordJobRun(em as never, scope, { kind: 'sweep' }, async () => {
      throw new Error('[internal] original failure')
    })).rejects.toThrow('original failure')
  })

  /**
   * The defect this recorder existed to prevent, and then exhibited.
   *
   * The completion used to be written by mutating the managed row and flushing. A job that calls `em.clear()`
   * — which the referral claim does, to recover from a unique violation — detaches that row, so the flush
   * wrote nothing and the row stayed `running` forever: exactly the "the machinery stopped" state this log
   * is here to make visible, reported for a job that finished perfectly well.
   */
  it('completes the row even when the work cleared the entity manager', async () => {
    const em = fakeEm()
    await recordJobRun(em as never, scope, { kind: 'dispatch' }, async () => {
      em.clear()
      return { counters: { started: 1 } }
    })
    expect(em.rows[0]).toMatchObject({ status: 'ok', counters: { started: 1 } })
  })

  it('records a failure even when the work cleared the entity manager', async () => {
    const em = fakeEm()
    await expect(recordJobRun(em as never, scope, { kind: 'dispatch' }, async () => {
      em.clear()
      throw new Error('[internal] after a clear')
    })).rejects.toThrow('after a clear')
    expect(em.rows[0]).toMatchObject({ status: 'failed' })
  })

  it('accepts a job that counted nothing', async () => {
    const em = fakeEm()
    await recordJobRun(em as never, scope, { kind: 'due_runs' }, async () => ({}))
    expect(em.rows[0]).toMatchObject({ status: 'ok', counters: null })
  })
})
