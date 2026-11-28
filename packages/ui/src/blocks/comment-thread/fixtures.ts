import type {
  CommentThreadAuthor,
  CommentThreadComment,
  CommentThreadProps,
  CommentThreadVisibilityOption,
} from '../contracts/comment-thread'

const noop = () => undefined

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

export const COMMENT_THREAD_FIXTURE_NOW = Date.parse('2026-03-12T12:00:00Z')

export const commentThreadCurrentUser: CommentThreadAuthor = { name: 'Dana Whitfield' }

export const commentThreadVisibilityOptions: CommentThreadVisibilityOption[] = [
  {
    value: 'customer',
    label: 'Reply to customer',
    description: 'The customer sees this reply in the portal',
    icon: 'eye',
    tone: 'neutral',
  },
  {
    value: 'internal',
    label: 'Internal note',
    description: 'Only your team sees this note',
    icon: 'lock',
    tone: 'info',
  },
]

export const commentThreadOwnActions = [
  { key: 'edit', label: 'Edit', icon: 'pencil-line' },
  { key: 'copy-link', label: 'Copy link', icon: 'link' },
  { key: 'delete', label: 'Delete', icon: 'trash-2', tone: 'destructive' as const },
]

export function buildCommentThreadFixtures(now: number): Record<string, CommentThreadProps> {
  const ago = (milliseconds: number) => new Date(now - milliseconds).toISOString()

  const shortThread: CommentThreadComment[] = [
    {
      id: 'comment-1',
      author: { name: 'Morgan Lee' },
      body: 'The replacement pump left the warehouse this morning. The carrier picked it up at 08:40.',
      createdAt: ago(3 * DAY_MS),
    },
    {
      id: 'comment-2',
      author: { name: 'Dana Whitfield' },
      body: 'Thanks. I let the customer know.\nDelivery should take two working days.',
      createdAt: ago(DAY_MS + 2 * HOUR_MS),
      own: true,
    },
    {
      id: 'comment-3',
      author: { name: 'Ravi Anand' },
      body: 'Tracking number is on the shipment record. The parcel reached the regional depot.',
      createdAt: ago(2 * HOUR_MS),
    },
  ]

  const visibilityThread: CommentThreadComment[] = [
    {
      id: 'comment-1',
      author: { name: 'Jordan Blake' },
      body: 'The pump stopped working after three weeks. Photos are attached to the claim.',
      createdAt: ago(9 * DAY_MS),
      visibility: 'customer',
    },
    {
      id: 'comment-2',
      author: { name: 'Dana Whitfield' },
      body: 'Serial number matches a batch with a known seal defect. Approve without inspection.',
      createdAt: ago(DAY_MS + 3 * HOUR_MS),
      visibility: 'internal',
      own: true,
    },
    {
      id: 'comment-3',
      author: { name: 'Priya Raman' },
      body: 'Agreed. Two replacement units are in stock in the main warehouse.',
      createdAt: ago(5 * HOUR_MS),
      visibility: 'internal',
    },
    {
      id: 'comment-4',
      author: { name: 'Dana Whitfield' },
      body: 'We are sending a replacement today. You do not need to return the faulty unit.',
      createdAt: ago(25 * MINUTE_MS),
      visibility: 'customer',
      own: true,
    },
  ]

  const ownThread: CommentThreadComment[] = [
    {
      id: 'comment-1',
      author: { name: 'Morgan Lee' },
      body: 'The customer asked whether the order can be split into two deliveries.',
      createdAt: ago(DAY_MS + 4 * HOUR_MS),
    },
    {
      id: 'comment-2',
      author: { name: 'Dana Whitfield' },
      body: 'Yes, as long as both parts leave this week.\nThe second delivery is free of charge.',
      createdAt: ago(3 * HOUR_MS),
      editedAt: ago(3 * HOUR_MS - 8 * MINUTE_MS),
      own: true,
      actions: commentThreadOwnActions,
    },
    {
      id: 'comment-3',
      author: { name: 'Dana Whitfield' },
      body: 'Customer confirmed the delivery address.',
      createdAt: ago(12 * MINUTE_MS),
      own: true,
      actions: commentThreadOwnActions,
    },
    {
      id: 'comment-4',
      author: { name: 'Dana Whitfield' },
      body: 'Courier is booked for Thursday morning.',
      createdAt: ago(10 * MINUTE_MS),
      own: true,
      actions: commentThreadOwnActions,
    },
  ]

  const deliveryThread: CommentThreadComment[] = [
    {
      id: 'comment-1',
      author: { name: 'Morgan Lee' },
      body: 'Two pallets are packed and waiting at dock 4.',
      createdAt: ago(2 * HOUR_MS),
    },
    {
      id: 'comment-2',
      author: { name: 'Dana Whitfield' },
      body: 'Courier is booked for Thursday.',
      createdAt: ago(2 * MINUTE_MS),
      own: true,
      failed: true,
    },
    {
      id: 'comment-3',
      author: { name: 'Dana Whitfield' },
      body: 'Customer asked for delivery before noon.',
      createdAt: ago(0),
      own: true,
      pending: true,
    },
  ]

  const longThread: CommentThreadComment[] = [
    {
      id: 'comment-1',
      author: { name: 'Alexandria Montgomery-Fairweather' },
      body:
        'I checked the three previous orders for this account. Each one used a different delivery address, and two of them were changed after the order was confirmed. Before we ship again I would like someone to call the customer and agree on one address, otherwise the courier will return the parcel a second time and we will pay for both trips.\n\nNotes from the last call are on the account record.',
      createdAt: ago(2 * DAY_MS),
    },
    {
      id: 'comment-2',
      author: { name: 'Ravi Anand' },
      body: 'Tracking reference: PARCEL-2026-03-10-000000000000000000000000000000000000000000000000000000000000000000000000-NORTH',
      createdAt: ago(4 * HOUR_MS),
      actions: [{ key: 'copy-link', label: 'Copy link', icon: 'link' }],
    },
  ]

  return {
    short: { title: 'Comments', count: 3, comments: shortThread, currentUser: commentThreadCurrentUser, onPost: noop },
    visibility: {
      title: 'Comments',
      count: 4,
      comments: visibilityThread,
      currentUser: commentThreadCurrentUser,
      visibilityOptions: commentThreadVisibilityOptions,
      defaultVisibility: 'customer',
      visibility: 'internal',
      onVisibilityChange: noop,
      onPost: noop,
    },
    ownActions: {
      title: 'Comments',
      count: 4,
      comments: ownThread,
      currentUser: commentThreadCurrentUser,
      onCommentAction: noop,
      onPost: noop,
    },
    delivery: {
      title: 'Comments',
      count: 3,
      comments: deliveryThread,
      currentUser: commentThreadCurrentUser,
      onRetryComment: noop,
      onPost: noop,
    },
    newestFirst: {
      title: 'Comments',
      count: 3,
      comments: shortThread,
      currentUser: commentThreadCurrentUser,
      order: 'desc',
      onPost: noop,
    },
    readOnly: {
      title: 'Comments',
      count: 3,
      comments: shortThread,
      canComment: false,
      composerDisabledReason: 'This claim is closed. Reopen it to add a comment.',
    },
    long: { title: 'Comments', count: 2, comments: longThread, onCommentAction: noop, onPost: noop },
    earlier: {
      title: 'Comments',
      count: 24,
      comments: shortThread,
      currentUser: commentThreadCurrentUser,
      hasEarlier: true,
      onLoadEarlier: noop,
      onPost: noop,
    },
    plain: { variant: 'plain', comments: shortThread, currentUser: commentThreadCurrentUser, onPost: noop },
    loading: { title: 'Comments', comments: [], status: 'loading', onPost: noop },
    error: {
      title: 'Comments',
      comments: [],
      status: 'error',
      errorMessage: 'Could not load comments. Check the connection and try again.',
      onRetry: noop,
      onPost: noop,
    },
    empty: {
      title: 'Comments',
      count: 0,
      comments: [],
      status: 'empty',
      currentUser: commentThreadCurrentUser,
      onPost: noop,
    },
  }
}

export const commentThreadFixtures = buildCommentThreadFixtures(COMMENT_THREAD_FIXTURE_NOW)
