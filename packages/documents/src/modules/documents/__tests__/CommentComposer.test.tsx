/** @jest-environment jsdom */

import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { PendingMention } from '../backend/documents/[id]/commentTypes'

const translations: Record<string, string> = {
  'documents.comments.actions.mention': 'Mention',
  'documents.comments.actions.send': 'Comment',
  'documents.comments.composer.placeholder': 'Write a comment…',
  'documents.comments.mentions.remove': 'Remove mention of {name}',
  'documents.comments.mentions.selected': 'Selected mentions',
  'documents.comments.title': 'Comments',
}

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, values?: Record<string, string>) => (
    (translations[key] ?? key).replace('{name}', values?.name ?? '')
  ),
}))

const mockMentionableUsers = [
  { id: 'USER-1', name: 'Ada Lovelace', trigger: 'Choose Ada' },
  { id: 'USER-2', name: 'Anna', trigger: 'Choose Anna' },
  { id: 'USER-3', name: 'Anna Kowalska', trigger: 'Choose Anna Kowalska' },
]

jest.mock('../backend/documents/[id]/MentionPicker', () => ({
  MentionPicker: ({ onPick }: { onPick: (user: { id: string; name: string }) => void }) => (
    <>
      {mockMentionableUsers.map((user) => (
        <button key={user.id} type="button" onClick={() => onPick({ id: user.id, name: user.name })}>
          {user.trigger}
        </button>
      ))}
    </>
  ),
}))

import { CommentComposer } from '../backend/documents/[id]/CommentComposer'

describe('CommentComposer mentions', () => {
  afterEach(() => jest.useRealTimers())

  it('drops pending mention metadata when the visible mention is deleted before submit', () => {
    const submitted = jest.fn()

    function Harness() {
      const [body, setBody] = React.useState('Review')
      const [pendingMentions, setPendingMentions] = React.useState<PendingMention[]>([])
      return (
        <CommentComposer
          documentId="11111111-1111-4111-8111-111111111111"
          body={body}
          pendingMentions={pendingMentions}
          replyToName={null}
          isSubmitting={false}
          onBodyChange={setBody}
          onMentionsChange={setPendingMentions}
          onSubmit={() => submitted({ body, pendingMentions })}
          onCancel={jest.fn()}
        />
      )
    }

    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Mention' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose Ada' }))

    expect(screen.getByRole('button', { name: 'Remove mention of Ada Lovelace' })).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Comments' }), { target: { value: 'Review' } })
    expect(screen.queryByRole('button', { name: 'Remove mention of Ada Lovelace' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
    expect(submitted).toHaveBeenCalledWith({ body: 'Review', pendingMentions: [] })
  })

  it('keeps a longer overlapping mention intact when the prefix mention chip is removed', () => {
    function Harness() {
      const [body, setBody] = React.useState('')
      const [pendingMentions, setPendingMentions] = React.useState<PendingMention[]>([])
      return (
        <CommentComposer
          documentId="11111111-1111-4111-8111-111111111111"
          body={body}
          pendingMentions={pendingMentions}
          replyToName={null}
          isSubmitting={false}
          onBodyChange={setBody}
          onMentionsChange={setPendingMentions}
          onSubmit={jest.fn()}
          onCancel={jest.fn()}
        />
      )
    }

    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Mention' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose Anna' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mention' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose Anna Kowalska' }))

    const textarea = screen.getByRole('textbox', { name: 'Comments' }) as HTMLTextAreaElement
    expect(textarea.value).toBe('@Anna @Anna Kowalska ')

    fireEvent.click(screen.getByRole('button', { name: 'Remove mention of Anna' }))

    expect(textarea.value).toBe(' @Anna Kowalska ')
    expect(screen.queryByRole('button', { name: 'Remove mention of Anna' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Remove mention of Anna Kowalska' })).toBeTruthy()
  })

  it('refocuses the composer when the reply target changes between same-length UUIDs', () => {
    jest.useFakeTimers()
    const props = {
      documentId: '11111111-1111-4111-8111-111111111111',
      body: '',
      pendingMentions: [],
      replyToName: 'Ada Lovelace',
      isSubmitting: false,
      onBodyChange: jest.fn(),
      onMentionsChange: jest.fn(),
      onSubmit: jest.fn(),
      onCancel: jest.fn(),
    }
    const { rerender } = render(
      <CommentComposer {...props} focusSignal="22222222-2222-4222-8222-222222222222" />,
    )
    const textarea = screen.getByRole('textbox', { name: 'Comments' })
    act(() => jest.runOnlyPendingTimers())
    expect(document.activeElement).toBe(textarea)

    screen.getByRole('button', { name: 'Mention' }).focus()
    rerender(<CommentComposer {...props} focusSignal="33333333-3333-4333-8333-333333333333" />)
    act(() => jest.runOnlyPendingTimers())

    expect(document.activeElement).toBe(textarea)
  })
})
