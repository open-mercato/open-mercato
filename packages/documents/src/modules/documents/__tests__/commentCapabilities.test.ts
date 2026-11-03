import { readCommentItems } from '../backend/documents/[id]/commentTypes'

const BASE = {
  documentId: '11111111-1111-4111-8111-111111111111',
  authorUserId: '22222222-2222-4222-8222-222222222222',
  body: 'Readable comment',
  createdAt: '2026-07-10T10:00:00.000Z',
  updatedAt: '2026-07-10T10:00:00.000Z',
}

describe('comment action capabilities', () => {
  it('normalizes resolve permission independently for parent comments and replies', () => {
    const [comment] = readCommentItems({ items: [{
      ...BASE,
      id: '33333333-3333-4333-8333-333333333333',
      canResolve: true,
      replies: [{
        ...BASE,
        id: '44444444-4444-4444-8444-444444444444',
        parentCommentId: '33333333-3333-4333-8333-333333333333',
        canResolve: false,
      }],
    }] })

    expect(comment.canResolve).toBe(true)
    expect(comment.replies[0].canResolve).toBe(false)
  })

  it('fails closed for legacy payloads without a projection', () => {
    const [comment] = readCommentItems({ items: [{ ...BASE, id: '55555555-5555-4555-8555-555555555555' }] })
    expect(comment.canResolve).toBe(false)
  })
})
