import { prepareJob, type JobScope } from '../lib/jobs'

type RecordedOp = {
  kind: 'select' | 'insert' | 'update' | 'delete'
  table: string
  onConflict: boolean
}

type FakeDbConfig = {
  /** Row id returned by a SELECT ... executeTakeFirst (the legacy read-then-write probe). */
  existingId?: string | null
  /** Row id returned by the atomic INSERT ... ON CONFLICT ... RETURNING. */
  upsertId?: string | null
  /** Force the ON CONFLICT upsert to throw so the degraded fallback path is exercised. */
  upsertThrows?: boolean
}

/**
 * Minimal Kysely test double for the job helpers. Records every top-level
 * operation (`selectFrom`/`insertInto`/`updateTable`) and whether an insert used
 * `onConflict`, so the test can assert the TOCTOU read-then-write window is gone.
 */
function createFakeDb(config: FakeDbConfig = {}) {
  const ops: RecordedOp[] = []
  const existingId = config.existingId ?? null
  const upsertId = config.upsertId ?? 'job-upserted'
  const upsertThrows = config.upsertThrows ?? false

  const makeOcStub = (): any => {
    const oc: any = {
      columns: () => oc,
      column: () => oc,
      constraint: () => oc,
      expression: () => oc,
      where: () => oc,
      doUpdateSet: () => oc,
      doNothing: () => oc,
    }
    return oc
  }

  const selectChain = (table: string): any => {
    const chain: any = {
      select: () => chain,
      selectAll: () => chain,
      where: () => chain,
      orderBy: () => chain,
      executeTakeFirst: async () => (existingId ? { id: existingId } : undefined),
      execute: async () => (existingId ? [{ id: existingId }] : []),
    }
    return chain
  }

  const insertChain = (table: string): any => {
    const op: RecordedOp = { kind: 'insert', table, onConflict: false }
    ops.push(op)
    const chain: any = {
      values: () => chain,
      onConflict: (cb: unknown) => {
        op.onConflict = true
        if (typeof cb === 'function') {
          try { (cb as (oc: any) => unknown)(makeOcStub()) } catch { /* builder shape only */ }
        }
        return chain
      },
      returning: () => chain,
      execute: async () => {
        if (upsertThrows && op.onConflict) {
          throw new Error('no unique or exclusion constraint matching the ON CONFLICT specification')
        }
        return upsertId ? [{ id: upsertId }] : []
      },
    }
    return chain
  }

  const mutateChain = (kind: 'update' | 'delete', table: string): any => {
    ops.push({ kind, table, onConflict: false })
    const chain: any = {
      set: () => chain,
      where: () => chain,
      returning: () => chain,
      execute: async () => ({ numUpdatedRows: BigInt(1), numDeletedRows: BigInt(0) }),
      executeTakeFirst: async () => ({ numUpdatedRows: BigInt(1) }),
    }
    return chain
  }

  const db: any = {
    _ops: ops,
    selectFrom: (table: unknown) => {
      ops.push({ kind: 'select', table: String(table), onConflict: false })
      return selectChain(String(table))
    },
    insertInto: (table: unknown) => insertChain(String(table)),
    updateTable: (table: unknown) => mutateChain('update', String(table)),
    deleteFrom: (table: unknown) => mutateChain('delete', String(table)),
  }
  return { db, ops }
}

const SCOPE: JobScope = {
  entityType: 'example:todo',
  organizationId: null,
  tenantId: 't1',
  partitionIndex: null,
  partitionCount: null,
}

describe('prepareJob concurrency safety (#2739)', () => {
  it('performs a single atomic upsert with no separate read-then-write window', async () => {
    const { db, ops } = createFakeDb({ upsertId: 'job-1' })

    const jobId = await prepareJob(db, SCOPE, 'reindexing', { totalCount: 10 })

    // The TOCTOU window came from a standalone SELECT on entity_index_jobs that
    // a concurrent scheduler could interleave with. There must be no such read.
    const reads = ops.filter((op) => op.kind === 'select' && op.table.includes('entity_index_jobs'))
    expect(reads).toHaveLength(0)

    // Exactly one write, and it must be an INSERT ... ON CONFLICT upsert.
    const inserts = ops.filter((op) => op.kind === 'insert' && op.table.includes('entity_index_jobs'))
    expect(inserts).toHaveLength(1)
    expect(inserts[0].onConflict).toBe(true)

    // No standalone UPDATE write on the happy path — the upsert covers both branches.
    const updates = ops.filter((op) => op.kind === 'update' && op.table.includes('entity_index_jobs'))
    expect(updates).toHaveLength(0)

    expect(jobId).toBe('job-1')
  })

  it('returns the upserted row id whether the scope row pre-existed or not', async () => {
    // A pre-existing row must not change the code path: still one atomic upsert.
    const { db, ops } = createFakeDb({ existingId: 'pre-existing', upsertId: 'job-2' })

    const jobId = await prepareJob(db, SCOPE, 'purging')

    expect(ops.filter((op) => op.kind === 'select' && op.table.includes('entity_index_jobs'))).toHaveLength(0)
    expect(jobId).toBe('job-2')
  })

  it('falls back to read-then-write when the atomic upsert is unsupported by the schema', async () => {
    // Mirrors indexer.ts: if the unique index is absent (e.g. mid-migration), the
    // upsert raises and prepareJob degrades to the legacy update-or-insert path.
    const { db, ops } = createFakeDb({ upsertThrows: true, existingId: null, upsertId: 'job-3' })

    const jobId = await prepareJob(db, SCOPE, 'reindexing')

    // The fallback attempted the atomic upsert first...
    expect(ops.some((op) => op.kind === 'insert' && op.onConflict)).toBe(true)
    // ...then degraded to the read-then-write probe.
    expect(ops.some((op) => op.kind === 'select' && op.table.includes('entity_index_jobs'))).toBe(true)
    expect(jobId).toBeTruthy()
  })
})
