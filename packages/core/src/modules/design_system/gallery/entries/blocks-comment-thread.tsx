import * as React from 'react'
import { Sparkles } from 'lucide-react'
import { CommentThread } from '@open-mercato/ui/blocks/comment-thread'
import {
  buildCommentThreadFixtures,
  commentThreadCurrentUser,
  commentThreadFixtures,
  commentThreadOwnActions,
  commentThreadVisibilityOptions,
} from '@open-mercato/ui/blocks/comment-thread/fixtures'
import {
  commentThreadPropsSchema,
  type CommentThreadComment,
  type CommentThreadProps,
} from '@open-mercato/ui/blocks/contracts/comment-thread'
import { Button } from '@open-mercato/ui/primitives/button'
import type { GalleryEntry } from '../types'

const POST_DELAY_MS = 900
const FAIL_KEYWORD = 'fail'

type DemoFixtureKey = keyof ReturnType<typeof buildCommentThreadFixtures>

function useDemoFixtures() {
  const [fixtures, setFixtures] = React.useState<ReturnType<typeof buildCommentThreadFixtures> | null>(null)
  React.useEffect(() => {
    setFixtures(buildCommentThreadFixtures(Date.now()))
  }, [])
  return fixtures
}

function DemoThread({ fixture, className, ...overrides }: { fixture: DemoFixtureKey } & Partial<CommentThreadProps>) {
  const fixtures = useDemoFixtures()
  const props = fixtures ? fixtures[fixture] : commentThreadFixtures.loading
  return <CommentThread {...props} {...(fixtures ? overrides : {})} className={className ?? 'w-full max-w-2xl'} />
}

function InteractiveExample() {
  const fixtures = useDemoFixtures()
  const [added, setAdded] = React.useState<CommentThreadComment[]>([])
  const [removed, setRemoved] = React.useState<string[]>([])
  const sequence = React.useRef(0)
  const timers = React.useRef<Array<ReturnType<typeof setTimeout>>>([])

  React.useEffect(() => {
    const pending = timers.current
    return () => pending.forEach((timer) => clearTimeout(timer))
  }, [])

  if (!fixtures) return <DemoThread fixture="loading" />

  const comments = [...fixtures.visibility.comments, ...added].filter((comment) => !removed.includes(comment.id))

  const post = (body: string, visibility?: string) =>
    new Promise<void>((resolve, reject) => {
      timers.current.push(
        setTimeout(() => {
          if (body.toLowerCase().includes(FAIL_KEYWORD)) {
            reject(new Error('[internal] demo failure'))
            return
          }
          sequence.current += 1
          setAdded((current) => [
            ...current,
            {
              id: `posted-${sequence.current}`,
              author: commentThreadCurrentUser,
              body,
              createdAt: new Date().toISOString(),
              visibility,
              own: true,
              actions: commentThreadOwnActions,
            },
          ])
          resolve()
        }, POST_DELAY_MS),
      )
    })

  const runAction = (commentId: string, actionKey: string) => {
    if (actionKey !== 'delete') return
    setRemoved((current) => [...current, commentId])
  }

  return (
    <CommentThread
      className="w-full max-w-2xl"
      title="Comments"
      count={comments.length}
      comments={comments}
      currentUser={commentThreadCurrentUser}
      visibilityOptions={commentThreadVisibilityOptions}
      defaultVisibility="customer"
      maxLength={280}
      onPost={post}
      onCommentAction={runAction}
    />
  )
}

function ExtrasExample() {
  const [draft, setDraft] = React.useState('')
  return (
    <DemoThread
      fixture="short"
      value={draft}
      onValueChange={setDraft}
      composerExtras={
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="font-normal max-sm:h-10"
          onClick={() => setDraft('Thank you for your patience. The replacement pump is on its way and should arrive within two working days.')}
        >
          <Sparkles aria-hidden="true" />
          Draft a reply
        </Button>
      }
    />
  )
}

const commentThreadCode = (props: string) => `import { CommentThread } from '@open-mercato/ui/blocks/comment-thread'

<CommentThread
${props}
/>`

export const commentThreadEntry: GalleryEntry = {
  id: 'comment-thread',
  title: 'CommentThread',
  importPath: '@open-mercato/ui/blocks/comment-thread',
  contract: {
    schema: commentThreadPropsSchema,
    importPath: '@open-mercato/ui/blocks/contracts/comment-thread',
    implementationPath: '@open-mercato/ui/blocks/comment-thread/CommentThread',
  },
  descriptionKey: 'design_system.entries.comment-thread.description',
  keywords: ['comments', 'notes', 'discussion', 'reply', 'composer', 'internal note', 'conversation'],
  usage: {
    do: [
      'Load, post, edit and delete in the host; pass comments in and react to onPost, onCommentAction and onRetryComment',
      'Return a promise from onPost; the block shows the pending state, clears the field when it resolves and keeps the text with an inline alert under the field when it rejects',
      'Add an optimistic comment with pending while it is being saved and switch it to failed when the save does not go through',
      'Give every visibility option an icon, a description and a tone; the same option tints the bubble of a comment and the composer, so the two cannot drift apart',
      'Make the audience people write to most often the default visibility; every other choice is marked with a tinted surface and a caption that names who will read the text',
      'Pass currentUser so the composer shows who is writing',
      'Build createdAt from real timestamps; the block shows relative time for the last seven days and a short date after that',
      'Use variant="plain" inside a card, drawer or dialog that is already a frame',
      'Pass renderBody when the host renders markdown or mentions; the default prints plain text with line breaks kept',
    ],
    dont: [
      'Do not use it for a full notes tab with a formatting toolbar, linked records and sorting; use NotesSection there',
      'Do not show a comment action as a separate button next to the menu; every per-comment action goes into the one menu',
      'Do not run a destructive action without a confirmation in onCommentAction',
      'Do not place the card variant inside another bordered surface',
      'Do not pre-sort comments to fake the order; the block sorts by createdAt and order decides where the composer sits',
      'Do not put a solid button into composerExtras; Post is the only solid button of the block',
    ],
  },
  accessibility: [
    'Comments are a list named after the title, or "Comments" when there is no title',
    'A comment that arrives after the first render is announced through a polite live region; the first load and earlier pages are not announced',
    'Each time is a time element with the exact date in dateTime and in the tooltip; the visible text is relative for the last seven days and a short date after that, both formatted with Intl in the application locale',
    'The audience of a comment is never colour alone: the tinted bubble starts with a caption in text, read before the body',
    'A grouped comment hides its avatar and header visually but keeps the author and the exact time as text for assistive technology',
    'The field always has an accessible name from composerLabel; the label is visually hidden because the placeholder repeats it',
    'Cmd+Enter or Ctrl+Enter posts from the field and the chord does not bubble to a surrounding dialog; it is exposed through aria-keyshortcuts and the visible hint is hidden from assistive technology',
    'The visibility choice is a menu button named after the group and the current choice; the caption of the chosen audience is linked to the field and to the button with aria-describedby, and focus returns to the field after a choice',
    'The actions menu of a comment shows on hover and on keyboard focus, stays visible on touch and in narrow columns, and is named after the comment author',
    'The field stays focused while a post is pending and after it succeeds',
    'A failed post and a failed comment are announced as alerts',
  ],
  faq: [
    {
      question: 'Why is the field not cleared after posting?',
      answer:
        'The promise returned from onPost rejected, or value is controlled and the host ignored the empty string sent through onValueChange.',
    },
    {
      question: 'Which comments get a tinted bubble?',
      answer:
        'Every comment whose visibility differs from the default visibility (defaultVisibility, or the first option). The tint comes from the tone of its option. A visibility value that matches no option shows its raw value in a neutral bubble, so pass visibilityOptions even to a read-only thread.',
    },
    {
      question: 'When are comments grouped?',
      answer:
        'When the next comment has the same author and visibility and was written within five minutes, and is neither edited, pending nor failed. The avatar and the header are shown once. Pass groupConsecutive={false} to turn it off.',
    },
    {
      question: 'Where does the earlier comments control go with newest first?',
      answer: 'It always sits at the old end of the list: above the list with order asc and below it with order desc.',
    },
  ],
  tokens: [
    '--card',
    '--border',
    '--input',
    '--control',
    '--radius-card',
    '--radius-field',
    '--shadow-focus',
    '--muted',
    '--muted-foreground',
    '--status-info-bg',
    '--status-info-border',
    '--status-info-text',
    '--status-info-icon',
    '--status-neutral-bg',
    '--status-neutral-border',
    '--status-neutral-text',
    '--status-error-text',
    '--status-error-icon',
  ],
  variants: [
    {
      id: 'interactive',
      title: 'Interactive',
      description:
        'Write and post with the button or Cmd+Enter. Choose Internal note in the field to see it tinted and post a note that lands in a tinted bubble. A comment containing the word fail is rejected to show the inline alert. The counter appears near the limit of 280 characters. Hover a posted comment for its menu.',
      render: () => <InteractiveExample />,
      code: commentThreadCode(`  title="Comments"
  count={comments.length}
  comments={comments}
  currentUser={{ name: 'Dana Whitfield' }}
  visibilityOptions={[
    { value: 'customer', label: 'Reply to customer', description: 'The customer sees this reply in the portal', icon: 'eye', tone: 'neutral' },
    { value: 'internal', label: 'Internal note', description: 'Only your team sees this note', icon: 'lock', tone: 'info' },
  ]}
  defaultVisibility="customer"
  maxLength={280}
  onPost={async (body, visibility) => {
    await createComment({ body, visibility })
    await reload()
  }}
  onCommentAction={(commentId, actionKey) => runCommentAction(commentId, actionKey)}`),
    },
    {
      id: 'short',
      title: 'Short thread',
      render: () => <DemoThread fixture="short" />,
      description: 'Avatar, author, relative time and the body. The composer shows who is writing.',
      code: commentThreadCode(`  title="Comments"
  count={3}
  comments={comments}
  currentUser={currentUser}
  onPost={postComment}`),
    },
    {
      id: 'visibility',
      title: 'Visibility set to internal',
      description:
        'Reply to customer is the default audience, so internal notes sit in a tinted bubble with a caption. The field takes the same tint because Internal note is chosen.',
      render: () => <DemoThread fixture="visibility" />,
      code: commentThreadCode(`  comments={comments}
  visibilityOptions={visibilityOptions}
  defaultVisibility="customer"
  visibility={visibility}
  onVisibilityChange={setVisibility}
  onPost={postComment}`),
    },
    {
      id: 'own-actions',
      title: 'Own comments with a menu',
      description:
        'Edit, copy link and delete sit in one menu that shows on hover and on focus. The second comment carries the edited marker; the last two were written minutes apart and share one header.',
      render: () => <DemoThread fixture="ownActions" />,
      code: commentThreadCode(`  comments={[
    {
      id: 'c2',
      author: { name: 'Dana Whitfield' },
      body: 'Yes, as long as both parts leave this week.',
      createdAt: comment.createdAt,
      editedAt: comment.editedAt,
      own: true,
      actions: [
        { key: 'edit', label: 'Edit', icon: 'pencil-line' },
        { key: 'delete', label: 'Delete', icon: 'trash-2', tone: 'destructive' },
      ],
    },
  ]}
  onCommentAction={(commentId, actionKey) => runCommentAction(commentId, actionKey)}
  onPost={postComment}`),
    },
    {
      id: 'delivery',
      title: 'Pending and failed',
      description: 'A failed comment keeps its text with a way to send it again. A pending one is dimmed until the host confirms it.',
      render: () => <DemoThread fixture="delivery" />,
      code: commentThreadCode(`  comments={[
    { id: 'c2', author, body: 'Courier is booked for Thursday.', createdAt, own: true, failed: true },
    { id: 'c3', author, body: 'Customer asked for delivery before noon.', createdAt, own: true, pending: true },
  ]}
  onRetryComment={(commentId) => resend(commentId)}
  onPost={postComment}`),
    },
    {
      id: 'newest-first',
      title: 'Newest first',
      description: 'The composer moves above the list.',
      render: () => <DemoThread fixture="newestFirst" />,
      code: commentThreadCode(`  order="desc"
  comments={comments}
  onPost={postComment}`),
    },
    {
      id: 'read-only',
      title: 'Cannot comment',
      description: 'One muted line with the reason replaces the composer.',
      render: () => <DemoThread fixture="readOnly" />,
      code: commentThreadCode(`  comments={comments}
  canComment={false}
  composerDisabledReason="This claim is closed. Reopen it to add a comment."`),
    },
    {
      id: 'long-content',
      title: 'Long content at 390',
      description: 'A long name, a long comment and an unbroken word wrap inside a narrow column. The comment menu stays visible in a narrow column.',
      render: () => <DemoThread fixture="long" className="w-full max-w-sm" />,
      code: commentThreadCode(`  comments={comments}
  onCommentAction={(commentId, actionKey) => runCommentAction(commentId, actionKey)}
  onPost={postComment}`),
    },
    {
      id: 'narrow-visibility',
      title: 'Visibility at 390',
      description: 'Avatars shrink, bubbles take the full width and the keyboard hint is dropped in a narrow column.',
      render: () => <DemoThread fixture="visibility" className="w-full max-w-sm" />,
      code: commentThreadCode(`  comments={comments}
  visibilityOptions={visibilityOptions}
  defaultVisibility="customer"
  onPost={postComment}`),
    },
    {
      id: 'composer-extras',
      title: 'Composer extras',
      description: 'The slot sits in the toolbar of the field and holds a quiet host action such as drafting a reply. Here it fills the controlled field.',
      render: () => <ExtrasExample />,
      code: commentThreadCode(`  comments={comments}
  value={draft}
  onValueChange={setDraft}
  composerExtras={
    <Button type="button" size="sm" variant="ghost" onClick={draftReply}>
      <Sparkles aria-hidden="true" />
      Draft a reply
    </Button>
  }
  onPost={postComment}`),
    },
    {
      id: 'load-earlier',
      title: 'Load earlier',
      description: 'A quiet control on a hairline at the old end of the list.',
      render: () => <DemoThread fixture="earlier" />,
      code: commentThreadCode(`  count={24}
  comments={comments}
  hasEarlier={hasEarlier}
  loadingEarlier={isFetchingEarlier}
  onLoadEarlier={fetchEarlier}
  onPost={postComment}`),
    },
    {
      id: 'plain',
      title: 'Plain',
      description: 'No frame and no title, for a drawer or a card that is already a frame.',
      render: () => <DemoThread fixture="plain" />,
      code: commentThreadCode(`  variant="plain"
  comments={comments}
  onPost={postComment}`),
    },
    {
      id: 'loading',
      title: 'Loading',
      description: 'The skeleton mirrors two comments and the composer.',
      render: () => <DemoThread fixture="loading" />,
      code: commentThreadCode(`  status="loading"
  comments={[]}
  onPost={postComment}`),
    },
    {
      id: 'error',
      title: 'Error with retry',
      render: () => <DemoThread fixture="error" />,
      code: commentThreadCode(`  status="error"
  errorMessage="Could not load comments. Check the connection and try again."
  onRetry={reload}
  comments={[]}
  onPost={postComment}`),
    },
    {
      id: 'empty',
      title: 'Empty',
      description: 'An invitation rather than an error: the composer stays so the first comment can be written.',
      render: () => <DemoThread fixture="empty" />,
      code: commentThreadCode(`  status="empty"
  comments={[]}
  onPost={postComment}`),
    },
  ],
}
