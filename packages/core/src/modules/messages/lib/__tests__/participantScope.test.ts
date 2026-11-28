import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  sql,
} from 'kysely'
import { applyMessageParticipantScope, channelInboxWideningClause } from '../participantScope'

// A minimal recording Kysely builder: it captures the join conditions and the
// OR-expression terms the helper emits so the participant-scope predicate can be
// asserted without a live database.
function makeRecorder() {
  const joinOnRefCalls: unknown[][] = []
  const joinOnCalls: unknown[][] = []
  const orExpressionCalls: unknown[][] = []
  const joinBuilder: any = {
    onRef: (...args: unknown[]) => { joinOnRefCalls.push(args); return joinBuilder },
    on: (...args: unknown[]) => { joinOnCalls.push(args); return joinBuilder },
  }
  const expressionBuilder: any = (...args: unknown[]) => { orExpressionCalls.push(args); return args }
  expressionBuilder.or = (expressions: unknown[]) => expressions
  const query: any = {
    selectFrom: () => query,
    leftJoin: (_table: string, join: (builder: any) => unknown) => { join(joinBuilder); return query },
    select: () => query,
    distinct: () => query,
    where: (...args: unknown[]) => {
      if (typeof args[0] === 'function') (args[0] as (eb: unknown) => unknown)(expressionBuilder)
      return query
    },
    execute: async () => [] as Array<{ id: string }>,
  }
  return { query, joinOnRefCalls, joinOnCalls, orExpressionCalls }
}

describe('applyMessageParticipantScope (#4133)', () => {
  it('joins message_recipients on the current user, excluding soft-deleted rows', () => {
    const recorder = makeRecorder()
    applyMessageParticipantScope(recorder.query.selectFrom('messages as m'), 'user-1')

    expect(recorder.joinOnRefCalls).toContainEqual(['m.id', '=', 'r.message_id'])
    expect(recorder.joinOnCalls).toContainEqual(['r.recipient_user_id', '=', 'user-1'])
    // Recipient soft-delete is part of the shared visibility boundary — it lives
    // in the helper, not the call sites, so it cannot drift.
    expect(recorder.joinOnCalls).toContainEqual(['r.deleted_at', 'is', null])
  })

  it('scopes visibility to sender OR matched recipient', () => {
    const recorder = makeRecorder()
    applyMessageParticipantScope(recorder.query.selectFrom('messages as m'), 'user-1')

    expect(recorder.orExpressionCalls).toContainEqual(['m.sender_user_id', '=', 'user-1'])
    expect(recorder.orExpressionCalls).toContainEqual(['r.message_id', 'is not', null])
  })

  it('emits exactly the sender-OR-recipient predicate and nothing else', () => {
    const recorder = makeRecorder()
    applyMessageParticipantScope(recorder.query.selectFrom('messages as m'), 'user-42')

    expect({
      onRef: recorder.joinOnRefCalls,
      on: recorder.joinOnCalls,
      or: recorder.orExpressionCalls,
    }).toEqual({
      onRef: [['m.id', '=', 'r.message_id']],
      on: [
        ['r.recipient_user_id', '=', 'user-42'],
        ['r.deleted_at', 'is', null],
      ],
      or: [
        ['m.sender_user_id', '=', 'user-42'],
        ['r.message_id', 'is not', null],
      ],
    })
  })
})

function compileDb() {
  return new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createIntrospector: (instance: Kysely<any>) => new PostgresIntrospector(instance),
    },
  })
}

function compileScope(userId: string, predicate?: ((eb: any) => any) | null) {
  const compiled = applyMessageParticipantScope(
    compileDb().selectFrom('messages as m') as never,
    userId,
    predicate,
  )
    .select('m.id')
    .compile()
  return { sql: compiled.sql.replace(/\s+/g, ' '), parameters: compiled.parameters }
}

describe('applyMessageParticipantScope — channel-inbox widening (#6106)', () => {
  const hubPredicate = () => sql`hub_predicate(m.id)`

  it('keeps the participant-only rule when no predicate is given', () => {
    const { sql: text } = compileScope('user-1')

    expect(text).not.toContain('hub_predicate')
    expect(text).not.toContain('"visibility"')
    expect(text).not.toContain('"source_entity_type"')
  })

  it('keeps the participant-only rule for a null predicate', () => {
    expect(compileScope('user-1', null).sql).not.toContain('hub_predicate')
  })

  it('adds the widening as a third OR branch next to sender and recipient', () => {
    const { sql: text } = compileScope('user-1', hubPredicate)

    expect(text).toMatch(/"m"\."sender_user_id" = \$\d+/)
    expect(text).toContain('"r"."message_id" is not null')
    expect(text).toMatch(/"r"\."message_id" is not null or \("m"\."visibility" = \$\d+ and/)
    expect(text).toContain('hub_predicate(m.id)')
  })

  it('confines the widening to public external-conversation messages', () => {
    const { parameters } = compileScope('user-1', hubPredicate)

    expect(parameters).toContain('public')
    expect(parameters).toContain('communication_channels.external_conversation')
  })

  it('widens only when the caller has no recipient row at all, deleted rows included', () => {
    const { sql: text } = compileScope('user-1', hubPredicate)

    const notExists = text.match(/not exists \(select 1 as "one" from "message_recipients" as "rx" where [^)]*\)/)
    expect(notExists).not.toBeNull()
    expect(notExists![0]).toContain('"rx"."message_id" = "m"."id"')
    expect(notExists![0]).toContain('"rx"."recipient_user_id" = $')
    // The join keeps its deleted_at filter; the NOT EXISTS must not — otherwise a
    // message the caller deleted would reappear through the widened branch.
    expect(notExists![0]).not.toContain('deleted_at')
  })

  it('exposes the same clause for the list route, the counter and the recipient helper', () => {
    const compiled = compileDb()
      .selectFrom('messages as m')
      .select('m.id')
      .where((eb) => channelInboxWideningClause(eb as never, 'user-9', hubPredicate))
      .compile()

    expect(compiled.sql).toContain('hub_predicate(m.id)')
    expect(compiled.parameters).toEqual(
      expect.arrayContaining(['public', 'communication_channels.external_conversation', 'user-9']),
    )
  })
})
