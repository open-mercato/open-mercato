/** @jest-environment jsdom */

import { render } from '@testing-library/react'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string) => key,
}))

import { CommentThreadList } from '../backend/documents/[id]/CommentThreadList'
import type { DocumentComment } from '../backend/documents/[id]/commentTypes'

const ANN_ID = '11111111-1111-4111-8111-111111111111'
const ANNA_ID = '22222222-2222-4222-8222-222222222222'
const DOLLAR_ID = '33333333-3333-4333-8333-333333333333'
const AUTHOR_ID = '44444444-4444-4444-8444-444444444444'

const labels: Record<string, string> = {
  [ANN_ID]: 'Ann',
  [ANNA_ID]: 'Anna',
  [DOLLAR_ID]: 'A$&B',
  [AUTHOR_ID]: 'Author',
}

function labelFor(userId: string): string {
  return labels[userId.toLowerCase()] ?? 'Unknown'
}

function comment(body: string, mentionedUserIds: string[]): DocumentComment {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    documentId: '66666666-6666-4666-8666-666666666666',
    parentCommentId: null,
    authorUserId: AUTHOR_ID,
    body,
    mentions: mentionedUserIds.map((userId) => ({ userId })),
    anchor: null,
    resolvedAt: null,
    resolvedByUserId: null,
    createdAt: '2026-07-18T10:00:00.000Z',
    updatedAt: '2026-07-18T10:00:00.000Z',
    canResolve: false,
    replies: [],
  }
}

function renderBody(target: DocumentComment) {
  const { container } = render(
    <CommentThreadList
      comments={[target]}
      canComment={false}
      resolvingCommentId={null}
      labelFor={labelFor}
      onJump={jest.fn()}
      onReply={jest.fn()}
      onResolve={jest.fn()}
      t={((key: string) => key) as never}
    />,
  )
  const paragraph = container.querySelector('p.whitespace-pre-wrap')
  const chips = Array.from(paragraph?.querySelectorAll('span') ?? []).map((chip) => chip.textContent)
  return { text: paragraph?.textContent ?? '', chips }
}

describe('comment mention rendering', () => {
  it('keeps prefix-colliding display names in separate chips', () => {
    const { text, chips } = renderBody(
      comment(`@[${ANN_ID}] and @[${ANNA_ID}] please review`, [ANN_ID, ANNA_ID]),
    )

    expect(chips).toEqual(['@Ann', '@Anna'])
    expect(text).toBe('@Ann and @Anna please review')
  })

  it('renders a display name containing replacement patterns verbatim', () => {
    const { text, chips } = renderBody(comment(`ping @[${DOLLAR_ID}] here`, [DOLLAR_ID]))

    expect(chips).toEqual(['@A$&B'])
    expect(text).toBe('ping @A$&B here')
  })

  it('leaves text that merely looks like a mention unchipped', () => {
    const { chips, text } = renderBody(comment('email @Anna directly', [ANNA_ID]))

    expect(chips).toEqual([])
    expect(text).toBe('email @Anna directly')
  })
})
