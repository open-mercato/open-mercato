import { recordJobRun } from '../job-runs'

/**
 * The recorder around a job, and the two properties that matter: it never breaks the job it describes, and
 * a failure is recorded AND re-thrown.
 */

type Row = Record<string, unknown>

function fakeEm(options: { failCreate?: boolean; failFlush?: boolean } = {}) {
  const rows: Row[] = []
  return {
    rows,
    create(_entity: unknown, data: Row) {
      if (options.failCreate) throw new Error('[internal] insert refused')
      const row: Row = { ...data }
      rows.push(row)
      return row
    },
    persist() { /* the fake keeps everything in `rows` */ },
    async flush() {
      if (options.failFlush) throw new Error('[internal] flush refused')
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
    const em = fakeEm()
    let calls = 0
    em.flush = async () => {
      calls += 1
      if (calls > 1) throw new Error('[internal] flush refused')
    }
    const result = await recordJobRun(em as never, scope, { kind: 'sweep' }, async () => ({ counters: { started: 2 } }))
    expect(result).toEqual({ counters: { started: 2 } })
  })

  it('still re-throws the work error when the failure write also fails', async () => {
    const em = fakeEm()
    let calls = 0
    em.flush = async () => {
      calls += 1
      if (calls > 1) throw new Error('[internal] flush refused')
    }
    await expect(recordJobRun(em as never, scope, { kind: 'sweep' }, async () => {
      throw new Error('[internal] original failure')
    })).rejects.toThrow('original failure')
  })

  it('accepts a job that counted nothing', async () => {
    const em = fakeEm()
    await recordJobRun(em as never, scope, { kind: 'due_runs' }, async () => ({}))
    expect(em.rows[0]).toMatchObject({ status: 'ok', counters: null })
  })
})
