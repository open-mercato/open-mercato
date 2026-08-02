import { applyMessageParticipantScope } from '../participantScope'

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
