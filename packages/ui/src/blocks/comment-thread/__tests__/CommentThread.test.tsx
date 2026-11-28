import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CommentThread } from '../CommentThread'
import {
  COMMENT_THREAD_FIXTURE_NOW,
  buildCommentThreadFixtures,
  commentThreadFixtures,
  commentThreadVisibilityOptions,
} from '../fixtures'
import {
  commentThreadPropsSchema,
  type CommentThreadComment,
  type CommentThreadProps,
} from '../../contracts/comment-thread'

const noop = () => undefined

const first: CommentThreadComment = {
  id: 'comment-1',
  author: { name: 'Morgan Lee' },
  body: 'First line\nSecond line',
  createdAt: '2026-03-10T09:12:00Z',
}
const second: CommentThreadComment = {
  id: 'comment-2',
  author: { name: 'Dana Whitfield' },
  body: 'Later comment',
  createdAt: '2026-03-11T09:12:00Z',
}

function renderThread(props: CommentThreadProps) {
  return renderWithProviders(<CommentThread {...props} />)
}

function slot(name: string) {
  return document.querySelector(`[data-slot="${name}"]`) as HTMLElement | null
}

function field() {
  return screen.getByRole('textbox', { name: 'Add a comment' }) as HTMLTextAreaElement
}

function postButton() {
  return document.querySelector('[data-slot="comment-thread-post"]') as HTMLButtonElement
}

function renderedIds() {
  return Array.from(document.querySelectorAll('[data-slot="comment-thread-comment"]')).map((node) =>
    node.getAttribute('data-comment-id'),
  )
}

function visibilityTrigger() {
  return slot('comment-thread-visibility') as HTMLButtonElement
}

async function chooseVisibility(label: string) {
  fireEvent.click(visibilityTrigger())
  fireEvent.click(await screen.findByRole('option', { name: label }))
}

function deferred() {
  let resolve: () => void = () => undefined
  let reject: (reason: Error) => void = () => undefined
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('CommentThread', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn()
  })

  it('keeps every fixture valid against the contract, also when built from another moment', () => {
    const rebuilt = buildCommentThreadFixtures(COMMENT_THREAD_FIXTURE_NOW + 90 * 24 * 60 * 60 * 1000)
    for (const fixture of [...Object.values(commentThreadFixtures), ...Object.values(rebuilt)]) {
      expect(commentThreadPropsSchema.safeParse(fixture).success).toBe(true)
    }
  })

  it('renders comments as a named list with author, machine-readable time and line breaks kept', () => {
    renderThread({ comments: [first, second], onPost: noop })
    const list = screen.getByRole('list', { name: 'Comments' })
    expect(list.tagName).toBe('UL')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('Morgan Lee')).toBeInTheDocument()
    const time = list.querySelector('time') as HTMLTimeElement
    expect(time.getAttribute('datetime')).toBe('2026-03-10T09:12:00Z')
    expect(time.textContent).not.toBe('')
    const body = document.querySelector('[data-slot="comment-thread-comment-body"]') as HTMLElement
    expect(body.textContent).toBe('First line\nSecond line')
    expect(body.className).toContain('whitespace-pre-wrap')
    expect(body.className).toContain('break-words')
  })

  it('names the list after the title and renders the requested heading level with the count', () => {
    renderThread({ comments: [first], title: 'Discussion', count: 12, headingLevel: 2, onPost: noop })
    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading).toHaveTextContent('Discussion')
    expect(slot('comment-thread-count')).toHaveTextContent('12')
    expect(screen.getByRole('list', { name: /Discussion/ })).toBeInTheDocument()
  })

  it('sorts oldest first with the composer below, and newest first with the composer on top', () => {
    const { unmount } = renderThread({ comments: [second, first], onPost: noop })
    expect(renderedIds()).toEqual(['comment-1', 'comment-2'])
    const listAsc = slot('comment-thread-list') as HTMLElement
    const composerAsc = slot('comment-thread-composer') as HTMLElement
    expect(listAsc.compareDocumentPosition(composerAsc) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    unmount()

    renderThread({ comments: [first, second], order: 'desc', onPost: noop })
    expect(renderedIds()).toEqual(['comment-2', 'comment-1'])
    const listDesc = slot('comment-thread-list') as HTMLElement
    const composerDesc = slot('comment-thread-composer') as HTMLElement
    expect(listDesc.compareDocumentPosition(composerDesc) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  })

  it('applies the card frame by default and none in the plain variant', () => {
    const { unmount } = renderThread({ comments: [first], onPost: noop })
    expect(slot('comment-thread')?.className).toContain('border-border')
    unmount()
    renderThread({ comments: [first], variant: 'plain', onPost: noop })
    expect(slot('comment-thread')?.className).not.toContain('border')
  })

  it('marks own and edited on a comment', () => {
    renderThread({ comments: [{ ...first, own: true, editedAt: '2026-03-10T09:30:00Z' }], onPost: noop })
    const item = slot('comment-thread-comment') as HTMLElement
    expect(item).toHaveAttribute('data-own', 'true')
    expect(item).toHaveTextContent('You')
    const edited = slot('comment-thread-comment-edited') as HTMLElement
    expect(edited).toHaveTextContent('Edited')
    expect(edited.querySelector('time')?.getAttribute('datetime')).toBe('2026-03-10T09:30:00Z')
  })

  it('puts a comment with a visibility other than the default into a tinted bubble that names the audience in text', () => {
    renderThread({
      comments: [
        { ...first, visibility: 'customer' },
        { ...second, visibility: 'internal' },
      ],
      visibilityOptions: commentThreadVisibilityOptions,
      onPost: noop,
    })
    const [plain, internal] = Array.from(document.querySelectorAll('[data-slot="comment-thread-comment"]')) as HTMLElement[]
    expect(plain.querySelector('[data-slot="comment-thread-comment-bubble"]')).toBeNull()
    expect(plain.querySelector('[data-slot="comment-thread-comment-visibility"]')).toBeNull()
    const bubble = internal.querySelector('[data-slot="comment-thread-comment-bubble"]') as HTMLElement
    expect(bubble).toHaveAttribute('data-tone', 'info')
    expect(bubble.className).toContain('bg-status-info-bg')
    expect(bubble.className).not.toContain('border')
    expect(internal.querySelector('[data-slot="comment-thread-comment-visibility"]')).toHaveTextContent('Internal note')
    expect(bubble).toContainElement(internal.querySelector('[data-slot="comment-thread-comment-body"]') as HTMLElement)
  })

  it('follows defaultVisibility when deciding which comments get a bubble', () => {
    renderThread({
      comments: [
        { ...first, visibility: 'customer' },
        { ...second, visibility: 'internal' },
      ],
      visibilityOptions: commentThreadVisibilityOptions,
      defaultVisibility: 'internal',
      onPost: noop,
    })
    const [customer, internal] = Array.from(document.querySelectorAll('[data-slot="comment-thread-comment"]')) as HTMLElement[]
    expect(customer.querySelector('[data-slot="comment-thread-comment-bubble"]')).toHaveAttribute('data-tone', 'neutral')
    expect(internal.querySelector('[data-slot="comment-thread-comment-bubble"]')).toBeNull()
  })

  it('falls back to the raw visibility value in a neutral bubble when no option matches', () => {
    renderThread({ comments: [{ ...first, visibility: 'Partner' }], onPost: noop })
    const bubble = slot('comment-thread-comment-bubble') as HTMLElement
    expect(bubble).toHaveAttribute('data-tone', 'neutral')
    expect(slot('comment-thread-comment-visibility')).toHaveTextContent('Partner')
  })

  it('shows relative time for a recent comment and a short date for an older one', () => {
    const now = Date.now()
    renderThread({
      comments: [
        { ...first, createdAt: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString() },
        { ...second, id: 'recent', createdAt: new Date(now - 3 * 60 * 60 * 1000).toISOString() },
        { ...second, id: 'fresh', author: { name: 'Ravi Anand' }, createdAt: new Date(now - 5000).toISOString() },
      ],
      onPost: noop,
    })
    const times = Array.from(document.querySelectorAll('[data-slot="comment-thread-list"] time')) as HTMLTimeElement[]
    expect(times[0].textContent).not.toMatch(/ago/)
    expect(times[0].textContent).toMatch(/\d/)
    expect(times[0].title).not.toBe('')
    expect(times[1].textContent).toMatch(/3 hr/)
    expect(times[2].textContent).toBe('Just now')
  })

  it('groups consecutive comments by the same author within a few minutes and keeps the author for assistive technology', () => {
    const close: CommentThreadComment = { ...second, id: 'comment-3', body: 'Right after', createdAt: '2026-03-11T09:14:00Z' }
    const late: CommentThreadComment = { ...second, id: 'comment-4', body: 'Much later', createdAt: '2026-03-11T11:00:00Z' }
    const { unmount } = renderThread({ comments: [first, second, close, late], onPost: noop })
    const items = Array.from(document.querySelectorAll('[data-slot="comment-thread-comment"]')) as HTMLElement[]
    expect(items.map((item) => item.getAttribute('data-grouped'))).toEqual([null, null, 'true', null])
    expect(items[2].querySelector('[data-slot="avatar"]')).toBeNull()
    const meta = items[2].querySelector('[data-slot="comment-thread-comment-meta"]') as HTMLElement
    expect(meta.className).toContain('sr-only')
    expect(meta).toHaveTextContent('Dana Whitfield')
    expect(meta.querySelector('time')?.getAttribute('datetime')).toBe('2026-03-11T09:14:00Z')
    unmount()

    renderThread({ comments: [first, second, close], groupConsecutive: false, onPost: noop })
    expect(document.querySelector('[data-grouped="true"]')).toBeNull()
  })

  it('shows the current user next to the composer', () => {
    renderThread({ comments: [first], currentUser: { name: 'Dana Whitfield' }, onPost: noop })
    const composer = slot('comment-thread-composer') as HTMLElement
    expect(composer.querySelector('[data-slot="avatar"]')).toHaveTextContent('DW')
  })

  it('uses renderBody when the host renders the body itself', () => {
    renderThread({
      comments: [first],
      renderBody: (comment) => <strong data-testid="custom-body">{comment.id}</strong>,
      onPost: noop,
    })
    expect(screen.getByTestId('custom-body')).toHaveTextContent('comment-1')
  })

  it('does not post an empty or whitespace-only body', () => {
    const onPost = jest.fn()
    renderThread({ comments: [first], onPost })
    expect(postButton()).toBeDisabled()
    fireEvent.change(field(), { target: { value: '   \n ' } })
    expect(postButton()).toBeDisabled()
    fireEvent.keyDown(field(), { key: 'Enter', metaKey: true })
    expect(onPost).not.toHaveBeenCalled()
  })

  it('posts the trimmed body on click and clears the field', () => {
    const onPost = jest.fn()
    renderThread({ comments: [first], onPost })
    fireEvent.change(field(), { target: { value: '  Hello there  ' } })
    expect(screen.getByRole('button', { name: 'Post' })).toBe(postButton())
    fireEvent.click(postButton())
    expect(onPost).toHaveBeenCalledWith('Hello there', undefined)
    expect(field().value).toBe('')
  })

  it('posts with Cmd+Enter and Ctrl+Enter but not with a bare Enter, and keeps the chord from bubbling', () => {
    const onPost = jest.fn()
    const onOuterKeyDown = jest.fn()
    renderWithProviders(
      <div onKeyDown={onOuterKeyDown}>
        <CommentThread comments={[first]} onPost={onPost} />
      </div>,
    )
    fireEvent.change(field(), { target: { value: 'One' } })
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(onPost).not.toHaveBeenCalled()
    expect(onOuterKeyDown).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(field(), { key: 'Enter', metaKey: true })
    expect(onPost).toHaveBeenCalledTimes(1)
    fireEvent.change(field(), { target: { value: 'Two' } })
    fireEvent.keyDown(field(), { key: 'Enter', ctrlKey: true })
    expect(onPost).toHaveBeenCalledTimes(2)
    expect(onOuterKeyDown).toHaveBeenCalledTimes(1)
    expect(field()).toHaveAttribute('aria-keyshortcuts', 'Meta+Enter Control+Enter')
  })

  it('owns the pending state while the post promise is unresolved and clears on success', async () => {
    const pending = deferred()
    const onPost = jest.fn(() => pending.promise)
    renderThread({ comments: [first], onPost })
    fireEvent.change(field(), { target: { value: 'Slow comment' } })
    fireEvent.click(postButton())
    expect(postButton()).toBeDisabled()
    expect(postButton()).toHaveAttribute('aria-busy', 'true')
    expect(field()).toHaveAttribute('readonly')
    expect(field().value).toBe('Slow comment')
    fireEvent.keyDown(field(), { key: 'Enter', metaKey: true })
    expect(onPost).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.resolve()
      await pending.promise
    })
    expect(field().value).toBe('')
    expect(field()).not.toHaveAttribute('readonly')
  })

  it('keeps the text and shows an inline alert when the post promise rejects', async () => {
    const pending = deferred()
    renderThread({ comments: [first], onPost: () => pending.promise })
    fireEvent.change(field(), { target: { value: 'Will fail' } })
    fireEvent.click(postButton())
    await act(async () => {
      pending.reject(new Error('[internal] offline'))
      await pending.promise.catch(noop)
    })
    expect(field().value).toBe('Will fail')
    const alert = slot('comment-thread-post-error') as HTMLElement
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert).toHaveTextContent('Could not post the comment')
    expect(alert).not.toHaveTextContent('offline')
    const frame = slot('comment-thread-composer-field') as HTMLElement
    expect(frame.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(frame).not.toContainElement(alert)
    expect(postButton()).not.toBeDisabled()
  })

  it('shows a host-supplied post error and host-controlled posting', () => {
    renderThread({
      comments: [first],
      value: 'Draft',
      onValueChange: noop,
      posting: true,
      postErrorMessage: 'The claim was closed meanwhile',
      onPost: noop,
    })
    expect(postButton()).toBeDisabled()
    expect(slot('comment-thread-post-error')).toHaveTextContent('The claim was closed meanwhile')
  })

  it('supports a controlled value and asks the host to clear it after posting', () => {
    const onValueChange = jest.fn()
    const onPost = jest.fn()
    renderThread({ comments: [first], value: 'Controlled', onValueChange, onPost })
    expect(field().value).toBe('Controlled')
    fireEvent.change(field(), { target: { value: 'Controlled!' } })
    expect(onValueChange).toHaveBeenCalledWith('Controlled!')
    expect(field().value).toBe('Controlled')
    fireEvent.click(postButton())
    expect(onPost).toHaveBeenCalledWith('Controlled', undefined)
    expect(onValueChange).toHaveBeenLastCalledWith('')
  })

  it('shows the counter only near the limit', () => {
    renderThread({ comments: [first], maxLength: 100, onPost: noop })
    fireEvent.change(field(), { target: { value: 'a'.repeat(50) } })
    expect(slot('comment-thread-counter')).toBeNull()
    fireEvent.change(field(), { target: { value: 'a'.repeat(95) } })
    expect(slot('comment-thread-counter')).toHaveTextContent('5 characters left')
    expect(field().getAttribute('aria-describedby')).toContain(slot('comment-thread-counter')?.id)
    expect(field()).toHaveAttribute('maxlength', '100')
    expect(slot('comment-thread-composer-toolbar')).toContainElement(slot('comment-thread-counter'))
  })

  it('keeps the field, the toolbar and the post button inside one bordered frame', () => {
    renderThread({ comments: [first], onPost: noop })
    const frame = slot('comment-thread-composer-field') as HTMLElement
    expect(frame.className).toContain('border-input')
    expect(frame.className).toContain('has-[textarea:focus]:shadow-focus')
    expect(frame).toContainElement(field())
    expect(frame).toContainElement(postButton())
    expect(field().className).toContain('border-0')
    expect(slot('comment-thread-shortcut')).toHaveAttribute('aria-hidden', 'true')
  })

  it('offers the visibility choice in a menu, posts with it and tints the whole field when it is not the default', async () => {
    const onPost = jest.fn()
    renderThread({ comments: [first], visibilityOptions: commentThreadVisibilityOptions, onPost })
    expect(visibilityTrigger()).toHaveAccessibleName('Who can see this comment: Reply to customer')
    expect(visibilityTrigger()).toHaveTextContent('Reply to customer')
    expect(slot('comment-thread-composer')).not.toHaveAttribute('data-tone')
    expect(slot('comment-thread-visibility-hint')).toHaveTextContent('The customer sees this reply in the portal')
    expect(slot('comment-thread-composer-field')).toContainElement(slot('comment-thread-visibility-hint'))

    fireEvent.click(visibilityTrigger())
    expect(await screen.findByRole('option', { name: 'Reply to customer' })).toHaveAttribute('data-checked', 'true')
    fireEvent.click(screen.getByRole('option', { name: 'Internal note' }))

    expect(visibilityTrigger()).toHaveTextContent('Internal note')
    expect(visibilityTrigger()).toHaveAttribute('data-value', 'internal')
    expect(slot('comment-thread-composer')).toHaveAttribute('data-tone', 'info')
    expect(slot('comment-thread-composer-field')?.className).toContain('bg-status-info-bg')
    expect(slot('comment-thread-visibility-hint')).toHaveTextContent('Only your team sees this note')
    expect(slot('comment-thread-visibility-hint')?.className).toContain('text-status-info-text')
    expect(field().getAttribute('aria-describedby')).toContain(slot('comment-thread-visibility-hint')?.id)

    fireEvent.change(field(), { target: { value: 'Note' } })
    fireEvent.click(postButton())
    expect(onPost).toHaveBeenCalledWith('Note', 'internal')
    expect(visibilityTrigger()).toHaveAttribute('data-value', 'internal')
  })

  it('honours defaultVisibility and a controlled visibility', async () => {
    const onVisibilityChange = jest.fn()
    renderThread({
      comments: [first],
      visibilityOptions: commentThreadVisibilityOptions,
      defaultVisibility: 'internal',
      visibility: 'internal',
      onVisibilityChange,
      onPost: noop,
    })
    expect(visibilityTrigger()).toHaveAttribute('data-value', 'internal')
    expect(slot('comment-thread-composer')).not.toHaveAttribute('data-tone')
    await chooseVisibility('Reply to customer')
    expect(onVisibilityChange).toHaveBeenCalledWith('customer')
    expect(visibilityTrigger()).toHaveAttribute('data-value', 'internal')
  })

  it('hides the composer and shows the reason when commenting is not allowed', () => {
    renderThread({ comments: [first], canComment: false, composerDisabledReason: 'This claim is closed' })
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(slot('comment-thread-composer-disabled')).toHaveTextContent('This claim is closed')
  })

  it('renders the composer extras slot', () => {
    renderThread({ comments: [first], composerExtras: <button type="button">Draft a reply</button>, onPost: noop })
    expect(slot('comment-thread-composer-extras')).toContainElement(screen.getByRole('button', { name: 'Draft a reply' }))
  })

  it('puts every comment action, destructive included, into one menu and reports the choice', async () => {
    const onCommentAction = jest.fn()
    renderThread({ ...commentThreadFixtures.ownActions, onCommentAction })
    const triggers = screen.getAllByRole('button', { name: 'Actions for the comment by Dana Whitfield' })
    expect(triggers).toHaveLength(3)
    expect(screen.queryByText('Delete')).not.toBeInTheDocument()
    fireEvent.click(triggers[0])
    const destructive = await screen.findByText('Delete')
    expect(screen.getByText('Edit')).toBeInTheDocument()
    fireEvent.click(destructive)
    expect(onCommentAction).toHaveBeenCalledWith('comment-2', 'delete')
  })

  it('shows a busy menu trigger while a comment action promise is unresolved', async () => {
    const pending = deferred()
    renderThread({ ...commentThreadFixtures.ownActions, onCommentAction: () => pending.promise })
    fireEvent.click(screen.getAllByRole('button', { name: 'Actions for the comment by Dana Whitfield' })[0])
    fireEvent.click(await screen.findByText('Edit'))
    const trigger = screen.getAllByRole('button', { name: 'Actions for the comment by Dana Whitfield' })[0]
    expect(trigger).toBeDisabled()
    await act(async () => {
      pending.resolve()
      await pending.promise
    })
    expect(screen.getAllByRole('button', { name: 'Actions for the comment by Dana Whitfield' })[0]).not.toBeDisabled()
  })

  it('shows pending and failed comments and retries a failed one', () => {
    const onRetryComment = jest.fn()
    renderThread({ ...commentThreadFixtures.delivery, onRetryComment })
    const items = Array.from(document.querySelectorAll('[data-slot="comment-thread-comment"]'))
    const pendingItem = items.find((node) => node.getAttribute('data-state') === 'pending') as HTMLElement
    const failedItem = items.find((node) => node.getAttribute('data-state') === 'failed') as HTMLElement
    expect(pendingItem).toHaveAttribute('aria-busy', 'true')
    expect(pendingItem).toHaveTextContent('Sending')
    expect(failedItem).toHaveTextContent('Not sent')
    expect(failedItem.querySelector('[data-slot="comment-thread-comment-failed"]')).toHaveAttribute('role', 'alert')
    fireEvent.click(screen.getByRole('button', { name: 'Send again' }))
    expect(onRetryComment).toHaveBeenCalledWith('comment-2')
  })

  it('shows the earlier control at the old end of the list and calls the host', () => {
    const onLoadEarlier = jest.fn()
    const { unmount } = renderThread({ comments: [first, second], hasEarlier: true, onLoadEarlier, onPost: noop })
    const control = slot('comment-thread-earlier') as HTMLElement
    const list = slot('comment-thread-list') as HTMLElement
    expect(control.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Load earlier comments' }))
    expect(onLoadEarlier).toHaveBeenCalledTimes(1)
    unmount()

    renderThread({ comments: [first, second], order: 'desc', hasEarlier: true, loadingEarlier: true, onLoadEarlier, onPost: noop })
    const controlDesc = slot('comment-thread-earlier') as HTMLElement
    const listDesc = slot('comment-thread-list') as HTMLElement
    expect(controlDesc.compareDocumentPosition(listDesc) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    expect(screen.getByRole('button', { name: /Load earlier comments/ })).toBeDisabled()
  })

  it('hides the earlier control without hasEarlier', () => {
    renderThread({ comments: [first], onLoadEarlier: noop, onPost: noop })
    expect(slot('comment-thread-earlier')).toBeNull()
  })

  it('announces a newly arrived comment politely but not the first render or earlier pages', async () => {
    const { rerender } = renderThread({ comments: [second], onPost: noop })
    const region = slot('comment-thread-status') as HTMLElement
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toHaveAttribute('role', 'status')
    expect(region.textContent).toBe('')

    rerender(<CommentThread comments={[first, second]} onPost={noop} />)
    expect(region.textContent).toBe('')

    const third: CommentThreadComment = { ...second, id: 'comment-3', author: { name: 'Ravi Anand' }, createdAt: '2026-03-12T09:12:00Z' }
    rerender(<CommentThread comments={[first, second, third]} onPost={noop} />)
    await waitFor(() => expect(region.textContent).toBe('New comment from Ravi Anand'))
  })

  it('renders a skeleton while loading', () => {
    renderThread(commentThreadFixtures.loading)
    expect(slot('comment-thread')).toHaveAttribute('aria-busy', 'true')
    expect(slot('comment-thread-skeleton')).toHaveTextContent('Loading comments')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('renders the error with retry and no composer', () => {
    const onRetry = jest.fn()
    renderThread({ ...commentThreadFixtures.error, onRetry })
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load comments. Check the connection and try again.')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('keeps the composer in the empty state and supports custom empty copy and slot', () => {
    const { unmount } = renderThread({ comments: [], onPost: noop })
    expect(screen.getByText('No comments yet')).toBeInTheDocument()
    expect(screen.getByText('Write the first comment below.')).toBeInTheDocument()
    expect(field()).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    unmount()

    const custom = renderThread({ comments: [], emptyTitle: 'Quiet here', emptyDescription: 'Ask the first question.', onPost: noop })
    expect(screen.getByText('Quiet here')).toBeInTheDocument()
    expect(screen.getByText('Ask the first question.')).toBeInTheDocument()
    custom.unmount()

    renderThread({ comments: [], status: 'empty', emptyState: <p>Custom empty</p>, canComment: false })
    expect(screen.getByText('Custom empty')).toBeInTheDocument()
  })

  it('uses a custom composer label, placeholder and post label', () => {
    renderThread({ comments: [first], composerLabel: 'Reply to the claim', placeholder: 'Type a reply', postLabel: 'Send reply', onPost: noop })
    const textbox = screen.getByRole('textbox', { name: 'Reply to the claim' })
    expect(textbox).toHaveAttribute('placeholder', 'Type a reply')
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeInTheDocument()
  })
})
