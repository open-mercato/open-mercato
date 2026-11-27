"use client"

import * as React from 'react'
import { AlertCircle, ChevronDown, Eye, Lock, MessageSquare, MoreHorizontal } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { cn } from '@open-mercato/shared/lib/utils'
import { ErrorMessage } from '@open-mercato/ui/backend/detail/ErrorMessage'
import { resolveRegisteredLucideIcon } from '@open-mercato/ui/backend/icons/lucideRegistryRuntime'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownList,
  DropdownTrigger,
} from '@open-mercato/ui/primitives/dropdown'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import type { BlockAction, BlockTone } from '../contracts/shared'
import type {
  CommentThreadAuthor,
  CommentThreadComment,
  CommentThreadHeadingLevel,
  CommentThreadProps,
  CommentThreadVisibilityOption,
} from '../contracts/comment-thread'

type TranslateFn = ReturnType<typeof useT>

const TONE_SURFACE_CLASS: Record<BlockTone, string> = {
  neutral: 'bg-status-neutral-bg',
  info: 'bg-status-info-bg',
  success: 'bg-status-success-bg',
  warning: 'bg-status-warning-bg',
  error: 'bg-status-error-bg',
}

const TONE_FIELD_CLASS: Record<BlockTone, string> = {
  neutral: 'border-status-neutral-border bg-status-neutral-bg',
  info: 'border-status-info-border bg-status-info-bg',
  success: 'border-status-success-border bg-status-success-bg',
  warning: 'border-status-warning-border bg-status-warning-bg',
  error: 'border-status-error-border bg-status-error-bg',
}

const TONE_TEXT_CLASS: Record<BlockTone, string> = {
  neutral: 'text-status-neutral-text',
  info: 'text-status-info-text',
  success: 'text-status-success-text',
  warning: 'text-status-warning-text',
  error: 'text-status-error-text',
}

const TONE_ICON_CLASS: Record<BlockTone, string> = {
  neutral: 'text-status-neutral-icon',
  info: 'text-status-info-icon',
  success: 'text-status-success-icon',
  warning: 'text-status-warning-icon',
  error: 'text-status-error-icon',
}

const MARKED_FALLBACK_TONE: BlockTone = 'info'
const COUNTER_MIN_THRESHOLD = 10
const COUNTER_THRESHOLD_RATIO = 0.1
const MINUTE_MS = 60 * 1000
const RELATIVE_TIME_WINDOW_MS = 7 * 24 * 60 * MINUTE_MS
const JUST_NOW_WINDOW_MS = 45 * 1000
const GROUP_WINDOW_MS = 5 * MINUTE_MS
const AVATAR_CLASS = 'size-7 text-sm font-normal @md:size-8'
const AVATAR_COLUMN_CLASS = 'w-7 shrink-0 @md:w-8'
const MENU_REVEAL_CLASS =
  '@md:pointer-fine:opacity-0 @md:pointer-fine:group-hover/comment:opacity-100 @md:pointer-fine:group-focus-within/comment:opacity-100 @md:pointer-fine:data-[state=open]:opacity-100'

const logger = createLogger('ui')
const reportedUnknownIcons = new Set<string>()

function resolveIcon(name: string | undefined) {
  const Icon = resolveRegisteredLucideIcon(name)
  if (Icon || !name || process.env.NODE_ENV === 'production' || reportedUnknownIcons.has(name)) return Icon
  reportedUnknownIcons.add(name)
  logger.warn('[internal] CommentThread received an icon name that is not in the icon registry', { icon: name })
  return Icon
}

function ActionIcon({ name }: { name: string | undefined }) {
  const Icon = resolveIcon(name)
  if (!Icon) return null
  return <Icon aria-hidden="true" className="size-4" />
}

function VisibilityIcon({ option, marked, className }: { option: CommentThreadVisibilityOption | undefined; marked: boolean; className?: string }) {
  const Icon = resolveIcon(option?.icon) ?? (marked ? Lock : Eye)
  return <Icon aria-hidden="true" className={cn('size-4 shrink-0', className)} />
}

function isPromise(value: void | Promise<void>): value is Promise<void> {
  return Boolean(value) && typeof (value as Promise<void>).then === 'function'
}

function formatFullDateTime(value: string, locale: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function formatSmartTime(value: string, locale: string, t: TranslateFn): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const now = new Date()
  const ageMs = Math.abs(now.getTime() - date.getTime())
  if (ageMs < JUST_NOW_WINDOW_MS) return t('ui.blocks.commentThread.justNow', 'Just now')
  if (ageMs < RELATIVE_TIME_WINDOW_MS) {
    const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
    const diffMinutes = (date.getTime() - now.getTime()) / MINUTE_MS
    if (ageMs < 45 * MINUTE_MS) return relative.format(Math.round(diffMinutes), 'minute')
    if (ageMs < 24 * 60 * MINUTE_MS) return relative.format(Math.round(diffMinutes / 60), 'hour')
    return relative.format(Math.round(diffMinutes / (24 * 60)), 'day')
  }
  const sameYear = date.getFullYear() === now.getFullYear()
  return new Intl.DateTimeFormat(locale, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

function toTimestamp(value: string): number {
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

function sortComments(comments: CommentThreadComment[], order: 'asc' | 'desc'): CommentThreadComment[] {
  const direction = order === 'asc' ? 1 : -1
  return comments
    .map((comment, index) => ({ comment, index, time: toTimestamp(comment.createdAt) }))
    .sort((left, right) => (left.time - right.time) * direction || left.index - right.index)
    .map((entry) => entry.comment)
}

function continuesGroup(previous: CommentThreadComment | undefined, comment: CommentThreadComment): boolean {
  if (!previous) return false
  if (comment.pending || comment.failed || comment.editedAt || previous.failed) return false
  if (previous.author.name !== comment.author.name) return false
  if (Boolean(previous.own) !== Boolean(comment.own)) return false
  if (previous.visibility !== comment.visibility) return false
  return Math.abs(toTimestamp(comment.createdAt) - toTimestamp(previous.createdAt)) <= GROUP_WINDOW_MS
}

type CommentMenuProps = {
  comment: CommentThreadComment
  actions: BlockAction[]
  pending: boolean
  onRun: (commentId: string, actionKey: string) => void
  t: TranslateFn
}

function CommentMenu({ comment, actions, pending, onRun, t }: CommentMenuProps) {
  const [open, setOpen] = React.useState(false)
  return (
    <Dropdown open={open} onOpenChange={setOpen}>
      <DropdownTrigger asChild>
        <IconButton
          type="button"
          variant="ghost"
          data-slot="comment-thread-comment-menu"
          className={cn('-my-1 shrink-0 text-muted-foreground transition-opacity', !pending && MENU_REVEAL_CLASS)}
          disabled={pending}
          aria-busy={pending || undefined}
          aria-label={t('ui.blocks.commentThread.commentActions', 'Actions for the comment by {name}', {
            name: comment.author.name,
          })}
        >
          {pending ? <Spinner size="sm" /> : <MoreHorizontal aria-hidden="true" />}
        </IconButton>
      </DropdownTrigger>
      <DropdownContent align="end" className="w-56">
        <DropdownList>
          {actions.map((action) => (
            <DropdownItem
              key={action.key}
              value={action.key}
              size={action.disabledReason ? 56 : 36}
              disabled={action.disabled === true}
              leading={action.icon ? <ActionIcon name={action.icon} /> : undefined}
              description={action.disabledReason}
              className={cn(action.tone === 'destructive' && 'text-destructive')}
              onSelect={() => {
                setOpen(false)
                onRun(comment.id, action.key)
              }}
            >
              {action.label}
            </DropdownItem>
          ))}
        </DropdownList>
      </DropdownContent>
    </Dropdown>
  )
}

type VisibilityCaptionProps = {
  id?: string
  slot: string
  option: CommentThreadVisibilityOption | undefined
  text: string
  tone: BlockTone | undefined
  marked: boolean
  className?: string
}

function VisibilityCaption({ id, slot, option, text, tone, marked, className }: VisibilityCaptionProps) {
  return (
    <p
      id={id}
      data-slot={slot}
      className={cn('flex min-w-0 items-start gap-2 text-sm leading-6', tone ? TONE_TEXT_CLASS[tone] : 'text-muted-foreground', className)}
    >
      <span aria-hidden="true" className="flex h-6 shrink-0 items-center">
        <VisibilityIcon option={option} marked={marked} className={tone ? TONE_ICON_CLASS[tone] : undefined} />
      </span>
      <span className="min-w-0 text-pretty break-words">{text}</span>
    </p>
  )
}

type CommentItemProps = {
  comment: CommentThreadComment
  locale: string
  grouped: boolean
  first: boolean
  visibilityOption: CommentThreadVisibilityOption | undefined
  marked: boolean
  menuPending: boolean
  renderBody: CommentThreadProps['renderBody']
  onRunAction: (commentId: string, actionKey: string) => void
  onRetryComment: CommentThreadProps['onRetryComment']
  t: TranslateFn
}

function CommentItem({
  comment,
  locale,
  grouped,
  first,
  visibilityOption,
  marked,
  menuPending,
  renderBody,
  onRunAction,
  onRetryComment,
  t,
}: CommentItemProps) {
  const fullCreated = formatFullDateTime(comment.createdAt, locale)
  const actions = comment.actions ?? []
  const showMenu = actions.length > 0 && comment.pending !== true && comment.failed !== true
  const tone: BlockTone | undefined = marked ? visibilityOption?.tone ?? (visibilityOption ? MARKED_FALLBACK_TONE : 'neutral') : undefined
  const captionText = visibilityOption?.label ?? comment.visibility
  const body = renderBody ? renderBody(comment) : comment.body
  const menu = showMenu ? (
    <CommentMenu comment={comment} actions={actions} pending={menuPending} onRun={onRunAction} t={t} />
  ) : null
  const bodyNode = (
    <div data-slot="comment-thread-comment-body" className="min-w-0 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
      {body}
    </div>
  )

  return (
    <li
      data-slot="comment-thread-comment"
      data-comment-id={comment.id}
      data-own={comment.own ? 'true' : undefined}
      data-grouped={grouped ? 'true' : undefined}
      data-state={comment.failed ? 'failed' : comment.pending ? 'pending' : 'sent'}
      data-visibility={comment.visibility}
      aria-busy={comment.pending || undefined}
      className={cn('group/comment flex min-w-0 items-start gap-3', !first && (grouped ? 'mt-1' : 'mt-5'))}
    >
      <div className={AVATAR_COLUMN_CLASS} aria-hidden="true">
        {grouped ? null : (
          <Avatar
            label={comment.author.name}
            src={comment.author.avatarUrl}
            size="md"
            variant={comment.own ? 'default' : 'monochrome'}
            className={cn(AVATAR_CLASS, comment.pending && 'opacity-60')}
          />
        )}
      </div>
      <div className={cn('flex min-w-0 flex-1 flex-col', !grouped && '@md:pt-1')}>
        {grouped ? (
          <span data-slot="comment-thread-comment-meta" className="sr-only">
            {comment.author.name}{' '}
            <time dateTime={comment.createdAt}>{fullCreated}</time>
          </span>
        ) : (
          <div className="flex min-w-0 items-start gap-2">
            <div
              data-slot="comment-thread-comment-meta"
              className={cn(
                'flex min-h-7 min-w-0 flex-1 flex-wrap items-center gap-x-2 text-sm leading-6 @md:min-h-6',
                comment.pending && 'opacity-60',
              )}
            >
              <span data-slot="comment-thread-comment-author" className="min-w-0 break-words text-foreground">
                {comment.author.name}
              </span>
              {comment.own ? (
                <span data-slot="comment-thread-comment-own" className="text-muted-foreground">
                  {t('ui.blocks.commentThread.you', 'You')}
                </span>
              ) : null}
              {comment.pending ? (
                <span data-slot="comment-thread-comment-pending" className="inline-flex items-center gap-2 text-muted-foreground">
                  <Spinner size="sm" />
                  {t('ui.blocks.commentThread.sending', 'Sending')}
                </span>
              ) : comment.failed ? null : (
                <time dateTime={comment.createdAt} title={fullCreated} className="whitespace-nowrap text-muted-foreground">
                  {formatSmartTime(comment.createdAt, locale, t)}
                </time>
              )}
              {comment.editedAt && !comment.pending && !comment.failed ? (
                <span data-slot="comment-thread-comment-edited" className="text-muted-foreground">
                  <time dateTime={comment.editedAt} title={formatFullDateTime(comment.editedAt, locale)}>
                    {t('ui.blocks.commentThread.edited', 'Edited')}
                  </time>
                </span>
              ) : null}
            </div>
            {menu}
          </div>
        )}
        <div className={cn('flex min-w-0 items-start gap-2', comment.pending && 'opacity-60')}>
          {tone ? (
            <div
              data-slot="comment-thread-comment-bubble"
              data-tone={tone}
              className={cn('flex min-w-0 flex-1 flex-col gap-1 rounded-lg p-3', !grouped && 'mt-1', TONE_SURFACE_CLASS[tone])}
            >
              {captionText ? (
                <VisibilityCaption slot="comment-thread-comment-visibility" option={visibilityOption} text={captionText} tone={tone} marked />
              ) : null}
              {bodyNode}
            </div>
          ) : (
            <div className="min-w-0 flex-1">{bodyNode}</div>
          )}
          {grouped && menu ? <div className="flex h-6 items-center">{menu}</div> : null}
        </div>
        {comment.failed ? (
          <div data-slot="comment-thread-comment-failed" role="alert" className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm leading-6 text-status-error-text">
            <AlertCircle aria-hidden="true" className="size-4 shrink-0 text-status-error-icon" />
            <span>{t('ui.blocks.commentThread.notSent', 'Not sent')}</span>
            {onRetryComment ? (
              <Button
                type="button"
                size="sm"
                variant="link"
                className="px-1 font-normal text-foreground underline"
                onClick={() => onRetryComment(comment.id)}
              >
                {t('ui.blocks.commentThread.retrySend', 'Send again')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  )
}

const SKELETON_ROWS = [
  { key: 'first', name: 'w-28', line: 'w-3/4', extra: 'w-1/2' },
  { key: 'second', name: 'w-20', line: 'w-2/3', extra: null },
]

function CommentThreadSkeleton({ label, showComposer, composerFirst }: { label: string; showComposer: boolean; composerFirst: boolean }) {
  const composer = showComposer ? (
    <div className="flex h-24 flex-col justify-between rounded-field bg-muted/60 p-3">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-8 w-16 self-end" />
    </div>
  ) : null
  return (
    <div data-slot="comment-thread-skeleton" className="flex flex-col gap-5">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="flex flex-col gap-5">
        {composerFirst ? composer : null}
        {SKELETON_ROWS.map((row) => (
          <div key={row.key} className="flex items-start gap-3">
            <Skeleton shape="circle" className="size-7 shrink-0 @md:size-8" />
            <div className="flex min-w-0 flex-1 flex-col gap-3 py-2">
              <Skeleton className={cn('h-4', row.name)} />
              <Skeleton className={cn('h-4', row.line)} />
              {row.extra ? <Skeleton className={cn('h-4', row.extra)} /> : null}
            </div>
          </div>
        ))}
        {composerFirst ? null : composer}
      </div>
    </div>
  )
}

type HeadingProps = {
  level: CommentThreadHeadingLevel
  id: string
  title: string
  count: number | undefined
}

function ThreadHeading({ level, id, title, count }: HeadingProps) {
  return React.createElement(
    `h${level}`,
    { id, 'data-slot': 'comment-thread-title', className: 'flex min-w-0 items-baseline gap-2 text-base leading-6 text-foreground' },
    <span className="min-w-0 break-words">{title}</span>,
    count !== undefined ? (
      <span data-slot="comment-thread-count" className="shrink-0 text-sm tabular-nums text-muted-foreground">
        {count}
      </span>
    ) : null,
  )
}

type VisibilityMenuProps = {
  options: CommentThreadVisibilityOption[]
  current: CommentThreadVisibilityOption | undefined
  baseline: string | undefined
  label: string
  disabled: boolean
  describedBy: string | undefined
  onChoose: (value: string) => void
  onChosen: () => void
}

function VisibilityMenu({ options, current, baseline, label, disabled, describedBy, onChoose, onChosen }: VisibilityMenuProps) {
  const [open, setOpen] = React.useState(false)
  const choseRef = React.useRef(false)
  return (
    <Dropdown open={open} onOpenChange={setOpen}>
      <DropdownTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          data-slot="comment-thread-visibility"
          data-value={current?.value}
          className="min-w-0 max-w-full font-normal max-sm:h-10"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-label={`${label}: ${current?.label ?? ''}`}
          aria-describedby={describedBy}
        >
          <VisibilityIcon option={current} marked={current?.value !== baseline} />
          <span className="min-w-0 truncate">{current?.label}</span>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownTrigger>
      <DropdownContent
        align="start"
        className="w-64"
        commandProps={{ label }}
        onCloseAutoFocus={(event) => {
          if (!choseRef.current) return
          choseRef.current = false
          event.preventDefault()
          onChosen()
        }}
      >
        <DropdownList>
          {options.map((option) => (
            <DropdownItem
              key={option.value}
              value={option.value}
              keywords={[option.label]}
              checked={option.value === current?.value}
              leading={<VisibilityIcon option={option} marked={option.value !== baseline} />}
              onSelect={() => {
                choseRef.current = true
                setOpen(false)
                onChoose(option.value)
              }}
            >
              {option.label}
            </DropdownItem>
          ))}
        </DropdownList>
      </DropdownContent>
    </Dropdown>
  )
}

function useShortcutKeys(): string {
  const [isApple, setIsApple] = React.useState(false)
  React.useEffect(() => {
    if (typeof navigator === 'undefined') return
    setIsApple(/Mac|iPhone|iPad/.test(navigator.userAgent))
  }, [])
  return isApple ? '⌘ Enter' : 'Ctrl Enter'
}

function ComposerAvatar({ user }: { user: CommentThreadAuthor }) {
  return (
    <div className={cn(AVATAR_COLUMN_CLASS, 'mt-1')} aria-hidden="true">
      <Avatar label={user.name} src={user.avatarUrl} size="md" className={AVATAR_CLASS} />
    </div>
  )
}

export function CommentThread(props: CommentThreadProps) {
  const t = useT()
  const locale = useLocale()
  const {
    comments,
    currentUser,
    groupConsecutive = true,
    order = 'asc',
    variant = 'card',
    title,
    count,
    headingLevel = 3,
    canComment = true,
    composerDisabledReason,
    placeholder,
    composerLabel,
    postLabel,
    value,
    onValueChange,
    maxLength,
    visibilityOptions,
    visibilityLabel,
    visibility,
    defaultVisibility,
    onVisibilityChange,
    onPost,
    posting,
    postErrorMessage,
    onCommentAction,
    onRetryComment,
    onLoadEarlier,
    hasEarlier,
    loadingEarlier,
    composerExtras,
    renderBody,
    status,
    errorMessage,
    onRetry,
    emptyState,
    emptyTitle,
    emptyDescription,
    className,
  } = props

  const baseId = React.useId()
  const headingId = `${baseId}-title`
  const fieldId = `${baseId}-field`
  const hintId = `${baseId}-hint`
  const counterId = `${baseId}-counter`
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const shortcutKeys = useShortcutKeys()

  const [internalValue, setInternalValue] = React.useState('')
  const [internalVisibility, setInternalVisibility] = React.useState<string | undefined>(undefined)
  const [postPending, setPostPending] = React.useState(false)
  const [postFailed, setPostFailed] = React.useState(false)
  const [earlierPending, setEarlierPending] = React.useState(false)
  const [pendingMenus, setPendingMenus] = React.useState<ReadonlySet<string>>(() => new Set())
  const [announcement, setAnnouncement] = React.useState('')

  const draft = value ?? internalValue
  const setDraft = React.useCallback(
    (next: string) => {
      if (value === undefined) setInternalValue(next)
      onValueChange?.(next)
    },
    [value, onValueChange],
  )

  const hasVisibility = Boolean(visibilityOptions && visibilityOptions.length > 0)
  const baselineVisibility = hasVisibility ? defaultVisibility ?? visibilityOptions?.[0]?.value : undefined
  const currentVisibility = hasVisibility ? visibility ?? internalVisibility ?? baselineVisibility : undefined
  const currentOption = visibilityOptions?.find((option) => option.value === currentVisibility)
  const isMarkedVisibility = hasVisibility && currentVisibility !== baselineVisibility
  const composerTone: BlockTone | undefined = isMarkedVisibility ? currentOption?.tone ?? MARKED_FALLBACK_TONE : undefined
  const composerCaption = currentOption?.description

  const optionByValue = React.useMemo(() => {
    const map = new Map<string, CommentThreadVisibilityOption>()
    visibilityOptions?.forEach((option) => map.set(option.value, option))
    return map
  }, [visibilityOptions])

  const sorted = React.useMemo(() => sortComments(comments, order), [comments, order])

  const knownIdsRef = React.useRef<Set<string> | null>(null)
  const newestSeenRef = React.useRef(0)
  React.useEffect(() => {
    if (status !== undefined && status !== 'ready') return
    const previous = knownIdsRef.current
    const newestSeen = newestSeenRef.current
    knownIdsRef.current = new Set(comments.map((comment) => comment.id))
    newestSeenRef.current = comments.reduce((latest, comment) => Math.max(latest, toTimestamp(comment.createdAt)), 0)
    if (previous === null) return
    const added = comments.filter(
      (comment) => !previous.has(comment.id) && !comment.pending && !comment.failed && toTimestamp(comment.createdAt) >= newestSeen,
    )
    if (added.length === 0) return
    setAnnouncement(
      added.length === 1
        ? t('ui.blocks.commentThread.newComment', 'New comment from {name}', { name: added[0].author.name })
        : t('ui.blocks.commentThread.newComments', '{count} new comments', { count: added.length }),
    )
  }, [comments, status, t])

  const runCommentAction = React.useCallback(
    (commentId: string, actionKey: string) => {
      const result = onCommentAction?.(commentId, actionKey)
      if (!isPromise(result)) return
      setPendingMenus((current) => new Set(current).add(commentId))
      const clear = () =>
        setPendingMenus((current) => {
          const next = new Set(current)
          next.delete(commentId)
          return next
        })
      result.then(clear, clear)
    },
    [onCommentAction],
  )

  const handleLoadEarlier = React.useCallback(() => {
    const result = onLoadEarlier?.()
    if (!isPromise(result)) return
    setEarlierPending(true)
    const clear = () => setEarlierPending(false)
    result.then(clear, clear)
  }, [onLoadEarlier])

  const isPosting = posting === true || postPending
  const trimmed = draft.trim()
  const canPost = trimmed.length > 0 && !isPosting

  const submit = React.useCallback(() => {
    if (!canPost || !onPost) return
    setPostFailed(false)
    const finish = () => {
      setDraft('')
      textareaRef.current?.focus()
    }
    let result: void | Promise<void>
    try {
      result = onPost(trimmed, currentVisibility)
    } catch {
      setPostFailed(true)
      return
    }
    if (!isPromise(result)) {
      finish()
      return
    }
    setPostPending(true)
    result.then(
      () => {
        setPostPending(false)
        finish()
      },
      () => {
        setPostPending(false)
        setPostFailed(true)
      },
    )
  }, [canPost, onPost, trimmed, currentVisibility, setDraft])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
    event.preventDefault()
    event.stopPropagation()
    submit()
  }

  const handleVisibilityChange = (next: string) => {
    if (!next) return
    if (visibility === undefined) setInternalVisibility(next)
    onVisibilityChange?.(next)
  }

  const isLoading = status === 'loading'
  const isError = status === 'error'
  const isEmpty = status === 'empty' || ((status === undefined || status === 'ready') && comments.length === 0)
  const listLabel = t('ui.blocks.commentThread.listLabel', 'Comments')
  const labelText = composerLabel ?? t('ui.blocks.commentThread.composerLabel', 'Add a comment')

  const remaining = maxLength !== undefined ? maxLength - draft.length : undefined
  const counterThreshold =
    maxLength !== undefined ? Math.max(COUNTER_MIN_THRESHOLD, Math.ceil(maxLength * COUNTER_THRESHOLD_RATIO)) : 0
  const showCounter = remaining !== undefined && remaining <= counterThreshold
  const postError = postErrorMessage ?? (postFailed ? t('ui.blocks.commentThread.postFailed', 'Could not post the comment. Your text is kept, try again.') : undefined)
  const describedBy = [composerCaption ? hintId : null, showCounter ? counterId : null].filter(Boolean).join(' ') || undefined

  const composer =
    isError ? null : canComment ? (
      <form
        data-slot="comment-thread-composer"
        data-visibility={currentVisibility}
        data-tone={composerTone}
        aria-busy={isPosting || undefined}
        className="flex min-w-0 items-start gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        {currentUser ? <ComposerAvatar user={currentUser} /> : null}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div
            data-slot="comment-thread-composer-field"
            className={cn(
              'flex min-w-0 cursor-text flex-col rounded-field border border-input bg-control shadow-xs transition-colors',
              composerTone && TONE_FIELD_CLASS[composerTone],
              'has-[textarea:focus]:border-foreground has-[textarea:focus]:shadow-focus',
            )}
            onMouseDown={(event) => {
              if (event.target !== event.currentTarget) return
              event.preventDefault()
              textareaRef.current?.focus()
            }}
          >
            {composerCaption ? (
              <VisibilityCaption
                id={hintId}
                slot="comment-thread-visibility-hint"
                option={currentOption}
                text={composerCaption}
                tone={composerTone}
                marked={isMarkedVisibility}
                className="px-3 pt-2"
              />
            ) : null}
            <label htmlFor={fieldId} className="sr-only">
              {labelText}
            </label>
            <Textarea
              ref={textareaRef}
              id={fieldId}
              data-slot="comment-thread-field"
              rows={1}
              autoResize
              maxRows={8}
              value={draft}
              maxLength={maxLength}
              readOnly={isPosting}
              aria-keyshortcuts="Meta+Enter Control+Enter"
              aria-describedby={describedBy}
              placeholder={placeholder ?? t('ui.blocks.commentThread.placeholder', 'Write a comment')}
              className={cn(
                'rounded-none border-0 bg-transparent px-3 pb-0 leading-6 shadow-none focus-visible:border-0 focus-visible:shadow-none',
                composerCaption ? 'min-h-6 pt-0' : 'min-h-14 pt-2',
              )}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
            />
            <div data-slot="comment-thread-composer-toolbar" className="flex min-w-0 cursor-default flex-wrap items-center gap-2 p-2">
              {visibilityOptions && hasVisibility ? (
                <VisibilityMenu
                  options={visibilityOptions}
                  current={currentOption}
                  baseline={baselineVisibility}
                  label={visibilityLabel ?? t('ui.blocks.commentThread.visibilityLabel', 'Who can see this comment')}
                  disabled={isPosting}
                  describedBy={composerCaption ? hintId : undefined}
                  onChoose={handleVisibilityChange}
                  onChosen={() => textareaRef.current?.focus()}
                />
              ) : null}
              {composerExtras ? (
                <div data-slot="comment-thread-composer-extras" className="flex min-w-0 flex-wrap items-center gap-2">
                  {composerExtras}
                </div>
              ) : null}
              {showCounter && remaining !== undefined ? (
                <span
                  id={counterId}
                  data-slot="comment-thread-counter"
                  className={cn('px-1 text-sm tabular-nums', remaining <= 0 ? 'text-status-error-text' : 'text-muted-foreground')}
                >
                  {t('ui.blocks.commentThread.charactersLeft', '{count} characters left', { count: Math.max(remaining, 0) })}
                </span>
              ) : null}
              <div className="ml-auto flex min-w-0 items-center gap-3">
                <span aria-hidden="true" data-slot="comment-thread-shortcut" className="hidden whitespace-nowrap text-sm text-muted-foreground @lg:inline">
                  {t('ui.blocks.commentThread.shortcutHint', '{keys} to post', { keys: shortcutKeys })}
                </span>
                <Button
                  type="submit"
                  size="sm"
                  data-slot="comment-thread-post"
                  className="max-sm:h-10"
                  disabled={!canPost}
                  aria-busy={isPosting || undefined}
                >
                  {isPosting ? <Spinner size="sm" /> : null}
                  <span className="min-w-0 truncate">{postLabel ?? t('ui.blocks.commentThread.post', 'Post')}</span>
                </Button>
              </div>
            </div>
          </div>
          {postError ? (
            <Alert status="error" style="lighter" size="sm" data-slot="comment-thread-post-error">
              {postError}
            </Alert>
          ) : null}
        </div>
      </form>
    ) : composerDisabledReason ? (
      <p data-slot="comment-thread-composer-disabled" className="flex min-w-0 items-start gap-2 text-sm leading-6 text-muted-foreground">
        <span aria-hidden="true" className="flex h-6 shrink-0 items-center">
          <Lock className="size-4" />
        </span>
        <span className="min-w-0 break-words">{composerDisabledReason}</span>
      </p>
    ) : null

  const showEarlier = Boolean(hasEarlier && onLoadEarlier && !isLoading && !isError && !isEmpty)
  const earlierBusy = loadingEarlier === true || earlierPending
  const earlierControl = showEarlier ? (
    <div data-slot="comment-thread-earlier" className="flex min-w-0 items-center gap-2">
      <span aria-hidden="true" className="h-px min-w-4 flex-1 bg-border" />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="shrink-0 font-normal text-muted-foreground max-sm:h-10"
        disabled={earlierBusy}
        aria-busy={earlierBusy || undefined}
        onClick={handleLoadEarlier}
      >
        {earlierBusy ? <Spinner size="sm" /> : null}
        {t('ui.blocks.commentThread.loadEarlier', 'Load earlier comments')}
      </Button>
      <span aria-hidden="true" className="h-px min-w-4 flex-1 bg-border" />
    </div>
  ) : null

  const composerFirst = order === 'desc'

  let content: React.ReactNode
  if (isLoading) {
    content = (
      <CommentThreadSkeleton
        label={t('ui.blocks.commentThread.loading', 'Loading comments')}
        showComposer={canComment}
        composerFirst={composerFirst}
      />
    )
  } else if (isError) {
    content = (
      <ErrorMessage
        label={errorMessage ?? t('ui.blocks.commentThread.error', 'Could not load comments')}
        className={cn('max-w-xl rounded-md', variant === 'card' && 'border-0 bg-transparent p-0')}
        action={
          onRetry ? (
            <Button type="button" size="sm" variant="outline" className="text-foreground max-sm:h-10" onClick={onRetry}>
              {t('ui.blocks.commentThread.retry', 'Try again')}
            </Button>
          ) : undefined
        }
      />
    )
  } else if (isEmpty) {
    content = emptyState ?? (
      <EmptyState
        size="sm"
        icon={<MessageSquare aria-hidden="true" className="size-5" />}
        title={emptyTitle ?? t('ui.blocks.commentThread.empty', 'No comments yet')}
        description={
          emptyDescription ??
          (canComment
            ? t('ui.blocks.commentThread.emptyDescription', 'Write the first comment below.')
            : t('ui.blocks.commentThread.emptyDescriptionReadOnly', 'Comments added to this record will show up here.'))
        }
        className="px-0 py-4 [&_p]:font-normal"
      />
    )
  } else {
    content = (
      <ul
        data-slot="comment-thread-list"
        aria-labelledby={title ? headingId : undefined}
        aria-label={title ? undefined : listLabel}
        className="flex min-w-0 flex-col"
      >
        {sorted.map((comment, index) => {
          const option = comment.visibility ? optionByValue.get(comment.visibility) : undefined
          return (
            <CommentItem
              key={comment.id}
              comment={comment}
              locale={locale}
              first={index === 0}
              grouped={groupConsecutive && continuesGroup(sorted[index - 1], comment)}
              visibilityOption={option}
              marked={comment.visibility !== undefined && comment.visibility !== baselineVisibility}
              menuPending={pendingMenus.has(comment.id)}
              renderBody={renderBody}
              onRunAction={runCommentAction}
              onRetryComment={onRetryComment}
              t={t}
            />
          )
        })}
      </ul>
    )
  }

  return (
    <section
      data-slot="comment-thread"
      data-variant={variant}
      data-order={order}
      aria-labelledby={title ? headingId : undefined}
      aria-busy={isLoading || undefined}
      className={cn(
        '@container flex min-w-0 flex-col gap-4',
        variant === 'card' && 'rounded-card border border-border bg-card p-4',
        className,
      )}
    >
      {title ? <ThreadHeading level={headingLevel} id={headingId} title={title} count={count} /> : null}
      {composerFirst && !isLoading ? composer : null}
      {composerFirst ? null : earlierControl}
      {content}
      {composerFirst ? earlierControl : null}
      {composerFirst || isLoading ? null : composer}
      <div data-slot="comment-thread-status" role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </section>
  )
}
