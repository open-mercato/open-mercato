import { z } from 'zod'
import { collectWritableKeys, guardWriteBody, inspectWritePayload, withIgnoredFieldsReport } from '../write-payload'

describe('collectWritableKeys', () => {
  it('reads the keys of a plain object schema', () => {
    const schema = z.object({ id: z.string(), ownerUserId: z.string().optional() })
    expect(collectWritableKeys(schema)).toEqual(new Set(['id', 'ownerUserId']))
  })

  it('reads through merge + partial, the shape the customers update schemas use', () => {
    const create = z.object({ title: z.string(), closureOutcome: z.enum(['won', 'lost']).optional() })
    const update = z.object({ id: z.string() }).merge(create.partial())
    expect(collectWritableKeys(update)).toEqual(new Set(['id', 'title', 'closureOutcome']))
  })

  it('unwraps the effects wrapper that superRefine and transform add', () => {
    const base = z.object({ id: z.string(), phoneNumber: z.string().optional() })
    const refined = base.superRefine(() => {}).transform((value) => value)
    expect(collectWritableKeys(refined)).toEqual(new Set(['id', 'phoneNumber']))
  })

  it('returns null for a shape it cannot introspect, so callers leave the payload alone', () => {
    expect(collectWritableKeys(z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]))).toBeNull()
  })
})

describe('inspectWritePayload', () => {
  const keys = new Set(['id', 'status', 'closureOutcome', 'lossNotes', 'ownerUserId'])

  it('aliases snake_case onto the declared camelCase key', () => {
    const result = inspectWritePayload(
      { id: 'deal-1', status: 'closed', closure_outcome: 'lost', loss_notes: 'undercut on price' },
      keys
    )
    expect(result.payload).toEqual({
      id: 'deal-1',
      status: 'closed',
      closureOutcome: 'lost',
      lossNotes: 'undercut on price',
    })
    expect(result.aliased).toEqual([
      { from: 'closure_outcome', to: 'closureOutcome' },
      { from: 'loss_notes', to: 'lossNotes' },
    ])
    expect(result.unwritable).toEqual([])
  })

  it('leaves a snake_case key the schema does not declare, and reports it as unknown', () => {
    const result = inspectWritePayload({ id: 'deal-1', not_a_field: 'x' }, keys)
    expect(result.payload).toEqual({ id: 'deal-1', not_a_field: 'x' })
    expect(result.unwritable).toEqual([{ key: 'not_a_field', reason: 'unknown' }])
  })

  it('reports a conflict rather than picking a winner when both spellings disagree', () => {
    const result = inspectWritePayload(
      { id: 'deal-1', closureOutcome: 'won', closure_outcome: 'lost' },
      keys
    )
    expect(result.conflicts).toEqual([{ camel: 'closureOutcome', snake: 'closure_outcome' }])
  })

  it('drops the duplicate silently only when both spellings agree', () => {
    const result = inspectWritePayload(
      { id: 'deal-1', closureOutcome: 'lost', closure_outcome: 'lost' },
      keys
    )
    expect(result.conflicts).toEqual([])
    expect(result.payload).toEqual({ id: 'deal-1', closureOutcome: 'lost' })
  })

  it('marks a declared-but-unwritable field immutable, not unknown', () => {
    const result = inspectWritePayload({ id: 'act-1', entityId: 'entity-2' }, new Set(['id']), {
      immutableFields: ['entityId'],
    })
    expect(result.unwritable).toEqual([{ key: 'entityId', reason: 'immutable' }])
  })

  it('still flags immutable fields when the schema cannot be introspected', () => {
    const result = inspectWritePayload({ id: 'act-1', entityId: 'entity-2' }, null, {
      immutableFields: ['entityId'],
    })
    expect(result.unwritable).toEqual([{ key: 'entityId', reason: 'immutable' }])
    expect(result.payload).toEqual({ id: 'act-1', entityId: 'entity-2' })
  })
})

describe('guardWriteBody', () => {
  const schema = z.object({ id: z.string(), isDone: z.boolean().optional(), organizationId: z.string().optional() })

  it('reports a misspelled key when aliasing is switched off, rather than dropping it', () => {
    const r = guardWriteBody(schema, { id: 'x', is_done: true }, { aliasSnakeCaseKeys: false })
    expect(r.body).toEqual({ id: 'x', is_done: true })
    expect(r.ignoredFields).toEqual([{ key: 'is_done', reason: 'misspelled' }])
  })

  it('applies it instead when aliasing is on, so misspelled never appears', () => {
    const r = guardWriteBody(schema, { id: 'x', is_done: true }, undefined)
    expect(r.body).toEqual({ id: 'x', isDone: true })
    expect(r.ignoredFields).toEqual([])
  })

  // Scope is derived from trusted context, so a round-tripped record carrying the
  // snake_case spelling a list emitted must not raise the ambiguity 400, and must
  // not be aliased into a way of steering scope.
  it('leaves tenant and organization scope keys alone in both spellings', () => {
    const r = guardWriteBody(
      schema,
      { id: 'x', organizationId: 'org-a', organization_id: 'org-b', tenant_id: 't-1' },
      undefined
    )
    expect(r.ignoredFields).toEqual([])
    expect(r.body).toMatchObject({ organizationId: 'org-a', organization_id: 'org-b', tenant_id: 't-1' })
  })
})

describe('guard messages', () => {
  const schema = z.object({ id: z.string(), entityId: z.string().optional() })
  const throwing = (config: any) => {
    try { guardWriteBody(schema, { id: 'x', entityId: 'y' }, config); return null }
    catch (e: any) { return e.body }
  }

  it('translates the default key when a translate hook is supplied', () => {
    const seen: string[] = []
    const body = throwing({
      immutableFields: ['entityId'],
      translate: (key: string, fallback?: string) => { seen.push(key); return `PL:${fallback}` },
    })
    expect(seen).toContain('errors.write_guard.immutable_field')
    expect(body.error).toBe('PL:This field cannot be changed after creation.')
  })

  it('lets a caller override the key with its own namespaced one', () => {
    const seen: string[] = []
    const body = throwing({
      immutableFields: ['entityId'],
      messages: { immutableField: { key: 'customers.errors.immutable_field' } },
      translate: (key: string, fallback?: string) => { seen.push(key); return `PL:${fallback}` },
    })
    expect(seen).toContain('customers.errors.immutable_field')
    expect(body.error).toBe('PL:This field cannot be changed after creation.')
  })

  it('returns the English fallback when no translate hook is supplied', () => {
    const body = throwing({ immutableFields: ['entityId'] })
    expect(body.error).toBe('This field cannot be changed after creation.')
  })
})

describe('withIgnoredFieldsReport', () => {
  it('leaves a clean response byte-identical', () => {
    expect(withIgnoredFieldsReport({ ok: true }, { ignoredFields: [] })).toEqual({ ok: true })
    expect(withIgnoredFieldsReport({ ok: true }, undefined)).toEqual({ ok: true })
  })

  it('names what it refused to write', () => {
    expect(
      withIgnoredFieldsReport({ ok: true }, { ignoredFields: [{ key: 'nope', reason: 'unknown' }] })
    ).toEqual({ ok: true, ignoredFields: [{ key: 'nope', reason: 'unknown' }] })
  })
})
