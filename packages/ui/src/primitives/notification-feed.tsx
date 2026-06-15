"use client"

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'

/**
 * Bell-icon inbox / notification list — the panel that opens when the
 * user clicks the bell affordance in the app shell. Distinct from
 * `Notification` (single toast in the top-right stack) and from
 * `ActivityFeed` (chronological audit log scoped to one entity).
 *
 * Compound API:
 *
 *   <NotificationFeed>             — root container card (rounded,
 *                                    bg-background, overflow-hidden).
 *   <NotificationFeedHeader>       — top row: title + actions slot
 *                                    (settings cog, "Mark all as read"
 *                                    link, etc.). Bordered bottom.
 *   <NotificationFeedList>         — `<ol>` list, `divide-y` so items
 *                                    auto-separate.
 *   <NotificationFeedItem>         — single notification entry. Slots:
 *                                     `icon`       — left, typically a
 *                                                    `NotificationFeedIconBadge`,
 *                                     `title`      — bold headline,
 *                                     `body`       — muted description,
 *                                     `timestamp`  — smaller muted suffix,
 *                                     `actions`    — right slot
 *                                                    (kebab IconButton),
 *                                     `children`   — optional indented
 *                                                    content (inline
 *                                                    action buttons,
 *                                                    file chip, reply).
 *                                    `unread` toggles a small dot near
 *                                    the title. `onClick` turns the
 *                                    whole row into a clickable
 *                                    affordance.
 *   <NotificationFeedFooter>       — bottom row. Bordered top. Typical
 *                                    content: a full-width Archive All
 *                                    button OR keyboard-hint + settings
 *                                    link (matches the two Figma
 *                                    `Notifications Footer [1.1]` /
 *                                    block-example variants).
 *   <NotificationFeedIconBadge>    — helper: `size-10 rounded-full
 *                                    bg-{tone}/10 text-{tone}` badge
 *                                    matching the Figma assembled
 *                                    example icon style.
 *
 * Figma source: DS Open Mercato `Notifications` page (`4096:21398`) —
 * `Notifications Items [1.1]` (`4308:731`, 8 variants — 4 designs
 * × 2 states: default + hover/selected), `Notifications Header [1.1]`
 * (`4308:1004`), `Notifications Footer [1.1]` (`4308:5526`),
 * `Notifications Tab Menu [1.1]` (`4349:46656`); assembled examples
 * `166926:7047`, `166926:7088`, `166926:7114`, `166926:7138`.
 *
 * ```tsx
 * <NotificationFeed>
 *   <NotificationFeedHeader title="Notifications">
 *     <IconButton size="sm" variant="ghost" aria-label="Settings">
 *       <Settings />
 *     </IconButton>
 *   </NotificationFeedHeader>
 *
 *   <NotificationFeedList>
 *     <NotificationFeedItem
 *       icon={
 *         <NotificationFeedIconBadge tone="indigo">
 *           <UserPlus className="size-5" />
 *         </NotificationFeedIconBadge>
 *       }
 *       title="New Lead Generated"
 *       body="John Smith submitted web form"
 *       timestamp="10 minutes ago"
 *       unread
 *       onClick={() => router.push('/leads/123')}
 *     />
 *   </NotificationFeedList>
 *
 *   <NotificationFeedFooter>
 *     <Button variant="outline" className="w-full">Archive all</Button>
 *   </NotificationFeedFooter>
 * </NotificationFeed>
 * ```
 */

const NotificationFeed = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="notification-feed"
    className={cn(
      'flex w-full flex-col overflow-hidden rounded-xl border border-input bg-background shadow-lg',
      className,
    )}
    {...props}
  />
))
NotificationFeed.displayName = 'NotificationFeed'

export type NotificationFeedHeaderProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Header title text. Renders as `<h3 className="text-base font-semibold">`. */
  title?: React.ReactNode
}

const NotificationFeedHeader = React.forwardRef<HTMLDivElement, NotificationFeedHeaderProps>(
  ({ className, title, children, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="notification-feed-header"
      className={cn(
        'flex items-center justify-between gap-3 border-b border-input px-4 py-3',
        className,
      )}
      {...props}
    >
      {title ? (
        <h3
          data-slot="notification-feed-header-title"
          className="text-base font-semibold text-foreground"
        >
          {title}
        </h3>
      ) : null}
      {children ? (
        <div data-slot="notification-feed-header-actions" className="inline-flex items-center gap-1">
          {children}
        </div>
      ) : null}
    </div>
  ),
)
NotificationFeedHeader.displayName = 'NotificationFeedHeader'

const NotificationFeedList = React.forwardRef<
  HTMLOListElement,
  React.HTMLAttributes<HTMLOListElement>
>(({ className, ...props }, ref) => (
  <ol
    ref={ref}
    data-slot="notification-feed-list"
    className={cn('flex flex-col divide-y divide-input', className)}
    {...props}
  />
))
NotificationFeedList.displayName = 'NotificationFeedList'

export type NotificationFeedItemProps = Omit<
  React.HTMLAttributes<HTMLLIElement>,
  'title' | 'onClick'
> & {
  /** Left slot — typically a `NotificationFeedIconBadge`. */
  icon?: React.ReactNode
  /** Bold headline. */
  title: React.ReactNode
  /** Optional muted body text under the title. */
  body?: React.ReactNode
  /** Optional smaller muted suffix under the body. */
  timestamp?: React.ReactNode
  /** Whether to render the unread indicator dot beside the title. */
  unread?: boolean
  /** Optional right-slot actions (e.g. kebab IconButton). Visible on
   * hover / focus per Figma. Pass `IconButton variant="ghost" size="sm"`. */
  actions?: React.ReactNode
  /** Optional click handler. When provided the whole row becomes a
   * clickable affordance (hover bg, focus ring). */
  onClick?: () => void
  /** Accessible label for the row when `onClick` is provided. Default:
   * the `title` if it's a string, otherwise `'Open notification'`. */
  clickAriaLabel?: string
}

const NotificationFeedItem = React.forwardRef<HTMLLIElement, NotificationFeedItemProps>(
  (
    {
      className,
      icon,
      title,
      body,
      timestamp,
      unread = false,
      actions,
      onClick,
      clickAriaLabel,
      children,
      ...props
    },
    ref,
  ) => {
    const t = useT()
    const interactive = typeof onClick === 'function'
    return (
      <li
        ref={ref}
        data-slot="notification-feed-item"
        data-unread={unread || undefined}
        className={cn(
          'group flex items-start gap-3 px-4 py-3',
          interactive ? 'cursor-pointer hover:bg-muted/40 focus-within:bg-muted/40' : '',
          className,
        )}
        onClick={onClick}
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-label={
          interactive
            ? clickAriaLabel ??
              (typeof title === 'string' ? title : t('ui.notificationFeed.item.openAriaLabel', 'Open notification'))
            : undefined
        }
        onKeyDown={
          interactive
            ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onClick?.()
                }
              }
            : undefined
        }
        {...props}
      >
        {icon ? (
          <span
            data-slot="notification-feed-item-icon"
            className="inline-flex shrink-0 items-center justify-center"
          >
            {icon}
          </span>
        ) : null}

        <div data-slot="notification-feed-item-body" className="flex min-w-0 flex-1 flex-col gap-1">
          <div
            data-slot="notification-feed-item-title"
            className="flex items-center gap-2 text-sm font-semibold text-foreground"
          >
            <span className="truncate">{title}</span>
            {unread ? (
              <span
                data-slot="notification-feed-item-unread-dot"
                aria-hidden="true"
                className="inline-block size-2 shrink-0 rounded-full bg-accent-indigo"
              />
            ) : null}
          </div>
          {body ? (
            <div
              data-slot="notification-feed-item-text"
              className="text-sm leading-5 text-muted-foreground"
            >
              {body}
            </div>
          ) : null}
          {timestamp ? (
            <div
              data-slot="notification-feed-item-timestamp"
              className="text-xs leading-4 text-muted-foreground"
            >
              {timestamp}
            </div>
          ) : null}
          {children ? (
            <div data-slot="notification-feed-item-children" className="mt-2 flex flex-wrap gap-2">
              {children}
            </div>
          ) : null}
        </div>

        {actions ? (
          <div
            data-slot="notification-feed-item-actions"
            className="ml-auto inline-flex shrink-0 items-start opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            onClick={(event) => event.stopPropagation()}
          >
            {actions}
          </div>
        ) : null}
      </li>
    )
  },
)
NotificationFeedItem.displayName = 'NotificationFeedItem'

const NotificationFeedFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="notification-feed-footer"
    className={cn(
      'flex items-center justify-between gap-3 border-t border-input px-4 py-3',
      className,
    )}
    {...props}
  />
))
NotificationFeedFooter.displayName = 'NotificationFeedFooter'

const ICON_TONE_MAP = {
  // Tints + matching icon color per Figma `Notifications Items [1.1]`
  // assembled examples. Surface is a soft `tone/10` background; icon
  // carries the semantic color directly.
  indigo: 'bg-accent-indigo/10 text-accent-indigo',
  success: 'bg-status-success-icon/10 text-status-success-icon',
  warning: 'bg-status-warning-icon/10 text-status-warning-icon',
  error: 'bg-status-error-icon/10 text-status-error-icon',
  info: 'bg-status-info-icon/10 text-status-info-icon',
  brand: 'bg-brand-violet/10 text-brand-violet',
  neutral: 'bg-muted text-muted-foreground',
} as const

const iconBadgeVariants = cva(
  'inline-flex shrink-0 items-center justify-center rounded-full',
  {
    variants: {
      tone: ICON_TONE_MAP,
      size: {
        sm: 'size-8',
        default: 'size-10',
      },
    },
    defaultVariants: { tone: 'indigo', size: 'default' },
  },
)

export type NotificationFeedIconBadgeProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof iconBadgeVariants>

const NotificationFeedIconBadge = React.forwardRef<
  HTMLSpanElement,
  NotificationFeedIconBadgeProps
>(({ className, tone, size, children, ...props }, ref) => (
  <span
    ref={ref}
    data-slot="notification-feed-icon-badge"
    data-tone={tone ?? 'indigo'}
    className={cn(iconBadgeVariants({ tone, size }), className)}
    {...props}
  >
    {children}
  </span>
))
NotificationFeedIconBadge.displayName = 'NotificationFeedIconBadge'

export type NotificationFeedIconBadgeTone = keyof typeof ICON_TONE_MAP

export {
  NotificationFeed,
  NotificationFeedHeader,
  NotificationFeedList,
  NotificationFeedItem,
  NotificationFeedFooter,
  NotificationFeedIconBadge,
}
