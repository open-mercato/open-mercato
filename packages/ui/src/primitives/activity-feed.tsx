"use client"

import * as React from 'react'
import { AlertTriangle, CheckCircle2, Clock, Download, MessageCircle, Paperclip, XCircle } from 'lucide-react'

import { cn } from '@open-mercato/shared/lib/utils'

/**
 * Chronological activity / audit timeline primitive — list of actor
 * actions (who did what, when) with optional inline objects and
 * indented attachment / comment / status rows beneath each entry.
 *
 * Compound API:
 *   <ActivityFeed>                  — root list container.
 *   <ActivityFeedItem>              — single entry. Slots:
 *                                       `avatar` (left, size-7 ~28px),
 *                                       `title`  (actor + verb + inline
 *                                                object — ReactNode so
 *                                                consumers can mix bold
 *                                                actor names with muted
 *                                                verbs and inline chips),
 *                                       `timestamp` (rendered as
 *                                                muted suffix text —
 *                                                no separator glyph),
 *                                       `actions` (right slot — typically
 *                                                a `MoreHorizontal`
 *                                                IconButton),
 *                                       `children` (indented attachment
 *                                                / comment / status row
 *                                                below the title).
 *   <ActivityFeedFileChip>          — paperclip + filename + size +
 *                                     optional download button. Used
 *                                     inline in the title or in the
 *                                     indented attachment row below.
 *   <ActivityFeedComment>           — comment card (avatar + body +
 *                                     Reply link). Indented attachment
 *                                     style — render as a child of
 *                                     `ActivityFeedItem`.
 *   <ActivityFeedStatusChip>        — semantic status pill (success /
 *                                     warning / info / error /
 *                                     neutral). Used inline in the
 *                                     title for short statuses
 *                                     ("Pending review", "Approved")
 *                                     or stacked in the indented row.
 *
 * Figma source: DS Open Mercato `Activity Feed` page (`164611:26451`)
 * — `Activity Feed [1.1]` (`166035:46833`, 5 entry variants: plain,
 * file attachments, comment, avatar stack, task-status pills);
 * `Activity Feed File Items [1.1]` (`165967:4028`); `Activity Feed
 * Comment Items [1.1]` (`166017:612`); `Activity Feed Task Status
 * Items [1.1]` (`166035:47290`, 4 statuses: success / warning /
 * info / error). Assembled example: `166707:8700`.
 *
 * ```tsx
 * <ActivityFeed>
 *   <ActivityFeedItem
 *     avatar={<Avatar label="Wei Chen" size="sm" />}
 *     title={<>Wei Chen <span className="text-muted-foreground font-normal">uploaded</span> <strong>Q2 financial report</strong></>}
 *     timestamp="4 min ago"
 *     actions={<IconButton variant="ghost" size="sm" aria-label="More"><MoreHorizontal /></IconButton>}
 *   >
 *     <ActivityFeedFileChip name="apex-report.pdf" size="4mb" onDownload={() => {}} />
 *   </ActivityFeedItem>
 *
 *   <ActivityFeedItem
 *     avatar={<Avatar label="Laura Perez" size="sm" />}
 *     title={<>Laura Perez <span className="text-muted-foreground font-normal">requested changes</span> <ActivityFeedStatusChip status="error">Needs revision</ActivityFeedStatusChip></>}
 *     timestamp="6 days ago"
 *   >
 *     <ActivityFeedComment onReply={() => {}}>
 *       Please revise the risk metrics and review portfolio allocations.
 *     </ActivityFeedComment>
 *   </ActivityFeedItem>
 * </ActivityFeed>
 * ```
 */

export type ActivityFeedProps = React.HTMLAttributes<HTMLOListElement>

const ActivityFeed = React.forwardRef<HTMLOListElement, ActivityFeedProps>(
  ({ className, ...props }, ref) => (
    <ol
      ref={ref}
      data-slot="activity-feed"
      className={cn('flex flex-col gap-3', className)}
      {...props}
    />
  ),
)
ActivityFeed.displayName = 'ActivityFeed'

export type ActivityFeedItemProps = Omit<React.HTMLAttributes<HTMLLIElement>, 'title'> & {
  /** Left slot — typically an `Avatar` at `size="sm"` (28px). */
  avatar?: React.ReactNode
  /** Headline row — actor + verb + inline object. Pass a ReactNode so
   * consumers can mix bold actor names with muted verbs and inline
   * chips (`ActivityFeedFileChip`, `ActivityFeedStatusChip`). */
  title: React.ReactNode
  /** Relative time string (e.g. `"4 min ago"`). Rendered as a muted
   * suffix on the title row — the wrapping `gap-x-2` provides the
   * visual separation from the title, no separator glyph is used. */
  timestamp?: React.ReactNode
  /** Right slot — typically a `MoreHorizontal` IconButton trigger. */
  actions?: React.ReactNode
}

const ActivityFeedItem = React.forwardRef<HTMLLIElement, ActivityFeedItemProps>(
  ({ className, avatar, title, timestamp, actions, children, ...props }, ref) => (
    <li
      ref={ref}
      data-slot="activity-feed-item"
      className={cn('flex items-start gap-3', className)}
      {...props}
    >
      {avatar ? (
        <span
          data-slot="activity-feed-item-avatar"
          className="mt-0.5 inline-flex shrink-0 items-center justify-center"
        >
          {avatar}
        </span>
      ) : null}
      <div data-slot="activity-feed-item-body" className="flex min-w-0 flex-1 flex-col gap-2">
        <div
          data-slot="activity-feed-item-title"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-6 text-foreground"
        >
          <span className="font-semibold">{title}</span>
          {timestamp ? (
            <span
              data-slot="activity-feed-item-timestamp"
              className="font-normal text-muted-foreground"
            >
              {timestamp}
            </span>
          ) : null}
        </div>
        {children ? (
          <div data-slot="activity-feed-item-content" className="flex flex-wrap gap-2">
            {children}
          </div>
        ) : null}
      </div>
      {actions ? (
        <div
          data-slot="activity-feed-item-actions"
          className="ml-auto inline-flex shrink-0 items-start"
        >
          {actions}
        </div>
      ) : null}
    </li>
  ),
)
ActivityFeedItem.displayName = 'ActivityFeedItem'

export type ActivityFeedFileChipProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> & {
  /** Filename rendered after the paperclip icon (e.g. `"apex-report.pdf"`). */
  name: React.ReactNode
  /** Optional size badge in muted text (e.g. `"4mb"`). */
  size?: React.ReactNode
  /** Click handler for the trailing download icon-button. When omitted
   * the download button is not rendered. */
  onDownload?: () => void
  /** Accessible label for the download button. Default `"Download"`. */
  downloadAriaLabel?: string
}

const ActivityFeedFileChip = React.forwardRef<HTMLDivElement, ActivityFeedFileChipProps>(
  (
    { className, name, size, onDownload, downloadAriaLabel = 'Download', ...props },
    ref,
  ) => (
    <div
      ref={ref}
      data-slot="activity-feed-file-chip"
      className={cn(
        'inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground shadow-xs',
        className,
      )}
      {...props}
    >
      <Paperclip aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate font-medium">{name}</span>
      {size ? (
        <span data-slot="activity-feed-file-chip-size" className="text-muted-foreground">
          ({size})
        </span>
      ) : null}
      {onDownload ? (
        <button
          type="button"
          data-slot="activity-feed-file-chip-download"
          aria-label={downloadAriaLabel}
          onClick={onDownload}
          className={cn(
            'ml-1 inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors',
            'hover:bg-muted/40 hover:text-foreground focus-visible:shadow-focus',
          )}
        >
          <Download aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
    </div>
  ),
)
ActivityFeedFileChip.displayName = 'ActivityFeedFileChip'

export type ActivityFeedCommentProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Optional leading icon. Default: speech bubble (`MessageCircle`). */
  icon?: React.ReactNode
  /** Click handler for the trailing `Reply` link. When omitted no
   * Reply button is rendered. */
  onReply?: () => void
  /** Custom label for the reply affordance. Default `"Reply"`. */
  replyLabel?: React.ReactNode
}

const ActivityFeedComment = React.forwardRef<HTMLDivElement, ActivityFeedCommentProps>(
  ({ className, icon, onReply, replyLabel = 'Reply', children, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="activity-feed-comment"
      className={cn(
        'inline-flex w-full items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs',
        className,
      )}
      {...props}
    >
      <span data-slot="activity-feed-comment-icon" aria-hidden="true" className="shrink-0">
        {icon ?? <MessageCircle className="size-4 text-muted-foreground" />}
      </span>
      <span data-slot="activity-feed-comment-body" className="min-w-0 flex-1 truncate">
        {children}
      </span>
      {onReply ? (
        <button
          type="button"
          data-slot="activity-feed-comment-reply"
          onClick={onReply}
          className={cn(
            'shrink-0 rounded-md text-sm font-medium text-accent-indigo outline-none transition-colors',
            'hover:text-accent-indigo/80 focus-visible:shadow-focus',
          )}
        >
          {replyLabel}
        </button>
      ) : null}
    </div>
  ),
)
ActivityFeedComment.displayName = 'ActivityFeedComment'

const STATUS_ICON_MAP: Record<
  'success' | 'warning' | 'info' | 'error' | 'neutral',
  React.ComponentType<{ className?: string; 'aria-hidden'?: 'true' | 'false' }>
> = {
  success: CheckCircle2,
  warning: AlertTriangle,
  info: Clock,
  error: XCircle,
  neutral: Clock,
}

const STATUS_TONE_MAP: Record<
  'success' | 'warning' | 'info' | 'error' | 'neutral',
  string
> = {
  // Icons keep the semantic color; chip surface stays neutral so the
  // visual emphasis sits with the icon (matches Figma `Task Status
  // Items [1.1]` — chips are bordered white pills, the status lives
  // in the icon color).
  success: 'text-status-success-icon',
  warning: 'text-status-warning-icon',
  info: 'text-status-info-icon',
  error: 'text-status-error-icon',
  neutral: 'text-muted-foreground',
}

export type ActivityFeedStatusChipProps = Omit<
  React.HTMLAttributes<HTMLSpanElement>,
  'children'
> & {
  status?: 'success' | 'warning' | 'info' | 'error' | 'neutral'
  /** Override the auto status icon. */
  icon?: React.ReactNode
  /** Chip label. */
  children: React.ReactNode
}

const ActivityFeedStatusChip = React.forwardRef<HTMLSpanElement, ActivityFeedStatusChipProps>(
  ({ className, status = 'neutral', icon, children, ...props }, ref) => {
    const Icon = STATUS_ICON_MAP[status]
    const iconTone = STATUS_TONE_MAP[status]
    return (
      <span
        ref={ref}
        data-slot="activity-feed-status-chip"
        data-status={status}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1 text-sm font-medium text-foreground shadow-xs',
          className,
        )}
        {...props}
      >
        <span
          data-slot="activity-feed-status-chip-icon"
          aria-hidden="true"
          className={cn('inline-flex shrink-0 items-center justify-center', iconTone)}
        >
          {icon ?? <Icon aria-hidden="true" className="size-4" />}
        </span>
        <span>{children}</span>
      </span>
    )
  },
)
ActivityFeedStatusChip.displayName = 'ActivityFeedStatusChip'

export {
  ActivityFeed,
  ActivityFeedItem,
  ActivityFeedFileChip,
  ActivityFeedComment,
  ActivityFeedStatusChip,
}
