import { commentThreadPropsSchema } from '../comment-thread'

const noop = () => undefined
const comment = {
  id: 'comment-1',
  author: { name: 'Morgan Lee' },
  body: 'First',
  createdAt: '2026-03-10T09:12:00Z',
}
const base = { comments: [comment], onPost: noop }
const options = [
  { value: 'customer', label: 'Reply to customer', icon: 'eye', tone: 'neutral' },
  { value: 'internal', label: 'Internal note', description: 'Only your team sees this', icon: 'lock', tone: 'info' },
]

function firstIssue(input: unknown) {
  const result = commentThreadPropsSchema.safeParse(input)
  if (result.success) return null
  return { message: result.error.issues[0]?.message, path: result.error.issues[0]?.path }
}

describe('CommentThread contract', () => {
  it('accepts a minimal thread', () => {
    expect(commentThreadPropsSchema.safeParse(base).success).toBe(true)
  })

  it('accepts a read-only thread without onPost', () => {
    const result = commentThreadPropsSchema.safeParse({
      comments: [comment],
      canComment: false,
      composerDisabledReason: 'This record is closed',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a full thread', () => {
    const result = commentThreadPropsSchema.safeParse({
      comments: [
        {
          ...comment,
          author: { name: 'Morgan Lee', avatarUrl: '/avatars/morgan.png' },
          editedAt: '2026-03-10T09:20:00Z',
          visibility: 'internal',
          own: true,
          actions: [
            { key: 'edit', label: 'Edit', icon: 'pencil-line' },
            { key: 'delete', label: 'Delete', tone: 'destructive' },
          ],
        },
        { ...comment, id: 'comment-2', pending: true },
        { ...comment, id: 'comment-3', failed: true },
      ],
      currentUser: { name: 'Dana Whitfield', avatarUrl: '/avatars/dana.png' },
      groupConsecutive: false,
      order: 'desc',
      variant: 'plain',
      title: 'Comments',
      count: 3,
      headingLevel: 2,
      placeholder: 'Write a reply',
      composerLabel: 'Reply',
      postLabel: 'Send',
      value: 'Draft',
      onValueChange: noop,
      maxLength: 2000,
      visibilityOptions: options,
      visibilityLabel: 'Audience',
      visibility: 'internal',
      defaultVisibility: 'customer',
      onVisibilityChange: noop,
      onPost: noop,
      posting: false,
      postErrorMessage: 'Could not post',
      onCommentAction: noop,
      onRetryComment: noop,
      onLoadEarlier: noop,
      hasEarlier: true,
      loadingEarlier: false,
      composerExtras: 'extras',
      renderBody: noop,
      emptyTitle: 'Nothing here',
      emptyDescription: 'Be the first to write',
      status: 'ready',
    })
    expect(result.success).toBe(true)
  })

  it('requires comments', () => {
    expect(commentThreadPropsSchema.safeParse({ onPost: noop }).success).toBe(false)
  })

  it('rejects duplicate comment ids', () => {
    expect(firstIssue({ ...base, comments: [comment, comment] })).toEqual({
      message: 'Comment ids must be unique',
      path: ['comments'],
    })
  })

  it('rejects a comment without an author name or with a date that is not ISO', () => {
    expect(commentThreadPropsSchema.safeParse({ ...base, comments: [{ ...comment, author: { name: '' } }] }).success).toBe(false)
    expect(commentThreadPropsSchema.safeParse({ ...base, comments: [{ ...comment, createdAt: 'yesterday' }] }).success).toBe(false)
    expect(commentThreadPropsSchema.safeParse({ ...base, comments: [{ ...comment, editedAt: '10 March' }] }).success).toBe(false)
  })

  it('rejects a comment that is pending and failed at once', () => {
    const result = commentThreadPropsSchema.safeParse({ ...base, comments: [{ ...comment, pending: true, failed: true }] })
    expect(result.success).toBe(false)
  })

  it('rejects duplicate action keys inside a comment', () => {
    const actions = [
      { key: 'edit', label: 'Edit' },
      { key: 'edit', label: 'Edit again' },
    ]
    const result = commentThreadPropsSchema.safeParse({ ...base, onCommentAction: noop, comments: [{ ...comment, actions }] })
    expect(result.success).toBe(false)
  })

  it('rejects comment actions without onCommentAction', () => {
    expect(firstIssue({ ...base, comments: [{ ...comment, actions: [{ key: 'edit', label: 'Edit' }] }] })).toEqual({
      message: 'comment actions require onCommentAction',
      path: ['onCommentAction'],
    })
  })

  it('requires onPost while commenting is allowed', () => {
    expect(firstIssue({ comments: [comment] })).toEqual({
      message: 'onPost is required unless canComment is false',
      path: ['onPost'],
    })
  })

  it('rejects a disabled reason while commenting is allowed', () => {
    expect(firstIssue({ ...base, composerDisabledReason: 'Closed' })).toEqual({
      message: 'composerDisabledReason requires canComment: false',
      path: ['composerDisabledReason'],
    })
  })

  it('rejects a controlled value without onValueChange', () => {
    expect(firstIssue({ ...base, value: 'Draft' })).toEqual({
      message: 'value requires onValueChange',
      path: ['onValueChange'],
    })
  })

  it('rejects a single visibility option and duplicate option values', () => {
    expect(commentThreadPropsSchema.safeParse({ ...base, visibilityOptions: [options[0]] }).success).toBe(false)
    expect(firstIssue({ ...base, visibilityOptions: [options[0], options[0]] })).toEqual({
      message: 'Visibility option values must be unique',
      path: ['visibilityOptions'],
    })
  })

  it('rejects a visibility that is not among the options', () => {
    expect(firstIssue({ ...base, visibilityOptions: options, visibility: 'partner', onVisibilityChange: noop })).toEqual({
      message: 'visibility must be one of visibilityOptions',
      path: ['visibility'],
    })
    expect(firstIssue({ ...base, visibilityOptions: options, defaultVisibility: 'partner' })).toEqual({
      message: 'defaultVisibility must be one of visibilityOptions',
      path: ['defaultVisibility'],
    })
    expect(commentThreadPropsSchema.safeParse({ ...base, defaultVisibility: 'internal' }).success).toBe(false)
  })

  it('rejects a controlled visibility without onVisibilityChange', () => {
    expect(firstIssue({ ...base, visibilityOptions: options, visibility: 'internal' })).toEqual({
      message: 'visibility requires onVisibilityChange',
      path: ['onVisibilityChange'],
    })
  })

  it('rejects hasEarlier without onLoadEarlier', () => {
    expect(firstIssue({ ...base, hasEarlier: true })).toEqual({
      message: 'hasEarlier requires onLoadEarlier',
      path: ['onLoadEarlier'],
    })
  })

  it('rejects unknown order, variant, heading level and option tone', () => {
    expect(commentThreadPropsSchema.safeParse({ ...base, order: 'newest' }).success).toBe(false)
    expect(commentThreadPropsSchema.safeParse({ ...base, variant: 'bubble' }).success).toBe(false)
    expect(commentThreadPropsSchema.safeParse({ ...base, headingLevel: 1 }).success).toBe(false)
    expect(
      commentThreadPropsSchema.safeParse({ ...base, visibilityOptions: [options[0], { value: 'internal', label: 'Internal', tone: 'purple' }] })
        .success,
    ).toBe(false)
  })

  it('rejects a current user without a name and a visibility icon that is not a kebab-case name', () => {
    expect(commentThreadPropsSchema.safeParse({ ...base, currentUser: { name: '' } }).success).toBe(false)
    expect(
      commentThreadPropsSchema.safeParse({ ...base, visibilityOptions: [options[0], { ...options[1], icon: 'LockIcon' }] }).success,
    ).toBe(false)
  })

  it('rejects a callback that is not a function', () => {
    expect(commentThreadPropsSchema.safeParse({ ...base, onPost: 'post' }).success).toBe(false)
  })
})
