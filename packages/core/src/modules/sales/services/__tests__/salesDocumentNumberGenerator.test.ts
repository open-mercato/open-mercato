import { SalesDocumentNumberGenerator, documentSequenceName } from '../salesDocumentNumberGenerator'

const REGISTRY_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const EXPECTED_SEQUENCE = 'sales_docseq_3f2504e04f8911d39a0c0305e82c3301'

const scope = {
  organizationId: '11111111-1111-1111-1111-111111111111',
  tenantId: '22222222-2222-2222-2222-222222222222',
}

type Statement = { sql: string; params: unknown[] }

class MissingRelationError extends Error {
  code = '42P01'
  constructor() {
    super('relation "sales_docseq_missing" does not exist')
  }
}

/**
 * Test double for the Postgres connection. `nextval` is modelled as what it actually is —
 * an atomic counter that never returns the same value twice — so the tests can assert the
 * invariant that matters for document numbering rather than the shape of the SQL.
 */
function createEm(options: { sequenceExists?: boolean; startAt?: number } = {}) {
  const state = {
    sequenceExists: options.sequenceExists ?? true,
    nextValue: options.startAt ?? 1,
    created: [] as string[],
  }
  const statements: Statement[] = []

  const execute = jest.fn(async (sql: string, params: unknown[] = []) => {
    statements.push({ sql, params })
    const normalized = sql.trim().toLowerCase()

    if (normalized.startsWith('create sequence')) {
      state.sequenceExists = true
      state.created.push(sql)
      return []
    }
    if (normalized.startsWith('insert into sales_document_sequences')) {
      return [{ id: REGISTRY_ID }]
    }
    if (normalized.includes('nextval(')) {
      if (!state.sequenceExists) throw new MissingRelationError()
      return [{ claimed: String(state.nextValue++) }]
    }
    if (normalized.includes('pg_sequence_last_value(')) {
      if (!state.sequenceExists) throw new MissingRelationError()
      return [{ last_value: state.nextValue > 1 ? String(state.nextValue - 1) : null }]
    }
    if (normalized.includes('setval(')) {
      state.nextValue = Number(params[0])
      return []
    }
    if (normalized.startsWith('update sales_document_sequences')) {
      return []
    }
    return []
  })

  const em = {
    findOne: jest.fn().mockResolvedValue(null),
    getConnection: () => ({ execute }),
  } as any

  return { em, execute, statements, state }
}

describe('SalesDocumentNumberGenerator sequence claiming (#5604)', () => {
  it('claims through nextval rather than an UPDATE on the counter row', async () => {
    const { em, statements } = createEm()
    const generator = new SalesDocumentNumberGenerator(em)

    const result = await generator.generate({ kind: 'order', ...scope })

    expect(result.sequence).toBe(1)
    const claim = statements.find((statement) => statement.sql.includes('nextval('))
    expect(claim).toBeDefined()
    expect(claim!.params).toEqual([scope.organizationId, scope.tenantId, 'order'])
    // The row-locking UPDATE this replaced must not come back.
    expect(statements.some((statement) => /current_value\s*=\s*sales_document_sequences\.current_value/i.test(statement.sql))).toBe(false)
  })

  it('never hands the same number to two concurrent callers', async () => {
    const { em } = createEm()
    const generator = new SalesDocumentNumberGenerator(em)

    const results = await Promise.all(
      Array.from({ length: 25 }, () => generator.generate({ kind: 'order', ...scope }))
    )

    const sequences = results.map((result) => result.sequence)
    expect(new Set(sequences).size).toBe(25)
    expect([...sequences].sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1))
    expect(new Set(results.map((result) => result.number)).size).toBe(25)
  })

  it('creates the registry row and its sequence on the first claim for a scope', async () => {
    const { em, statements, state } = createEm({ sequenceExists: false })
    const generator = new SalesDocumentNumberGenerator(em)

    const result = await generator.generate({ kind: 'order', ...scope })

    expect(result.sequence).toBe(1)
    expect(statements.some((statement) => statement.sql.includes('insert into sales_document_sequences'))).toBe(true)
    expect(state.created).toHaveLength(1)
    expect(state.created[0]).toContain(`"${EXPECTED_SEQUENCE}"`)
  })

  it('keeps separate document kinds on independent sequences', async () => {
    const { em, statements } = createEm()
    const generator = new SalesDocumentNumberGenerator(em)

    await generator.generate({ kind: 'order', ...scope })
    await generator.generate({ kind: 'quote', ...scope })

    const claimKinds = statements
      .filter((statement) => statement.sql.includes('nextval('))
      .map((statement) => statement.params[2])
    expect(claimKinds).toEqual(['order', 'quote'])
  })

  it('refuses to issue a number once the sequence passes its ceiling instead of clamping', async () => {
    const { em } = createEm({ startAt: 1_000_000_001 })
    const generator = new SalesDocumentNumberGenerator(em)

    await expect(generator.generate({ kind: 'order', ...scope })).rejects.toThrow('exhausted')
  })

  it('propagates claim failures instead of falling back to a duplicate number', async () => {
    const { em, execute } = createEm()
    execute.mockRejectedValueOnce(new Error('connection lost'))
    const generator = new SalesDocumentNumberGenerator(em)

    await expect(generator.generate({ kind: 'order', ...scope })).rejects.toThrow('connection lost')
  })

  it('peeks the next value without consuming one', async () => {
    const { em, statements } = createEm()
    const generator = new SalesDocumentNumberGenerator(em)

    await generator.generate({ kind: 'order', ...scope })
    const peeked = await generator.peekSequences(scope)

    expect(peeked.order).toBe(2)
    expect(statements.filter((statement) => statement.sql.includes('nextval('))).toHaveLength(1)
  })

  it('reports the start value for a scope whose sequence was never used', async () => {
    const { em } = createEm()
    const generator = new SalesDocumentNumberGenerator(em)

    await expect(generator.peekSequences(scope)).resolves.toEqual({ order: 1, quote: 1, return: 1 })
  })

  it('repositions the sequence with setval so the next claim returns the requested value', async () => {
    const { em, statements } = createEm()
    const generator = new SalesDocumentNumberGenerator(em)

    await generator.setNextSequence('order', scope, 500)
    const next = await generator.generate({ kind: 'order', ...scope })

    const setval = statements.find((statement) => statement.sql.includes('setval('))
    expect(setval).toBeDefined()
    expect(setval!.params[0]).toBe(500)
    expect(next.sequence).toBe(500)
  })
})

describe('documentSequenceName', () => {
  it('derives a stable, quoted-identifier-safe name from the registry row id', () => {
    expect(documentSequenceName(REGISTRY_ID)).toBe(EXPECTED_SEQUENCE)
    expect(documentSequenceName(REGISTRY_ID.toUpperCase())).toBe(EXPECTED_SEQUENCE)
    expect(EXPECTED_SEQUENCE.length).toBeLessThanOrEqual(63)
  })

  it('rejects anything that is not a UUID rather than building an injectable identifier', () => {
    expect(() => documentSequenceName('order"; drop table sales_orders; --')).toThrow('[internal]')
    expect(() => documentSequenceName('')).toThrow('[internal]')
  })
})
