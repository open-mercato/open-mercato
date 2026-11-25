"use client"

import * as React from 'react'

import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'

/**
 * Full result of an action or a page-level error: a face in a tile that
 * matches the status, a title,
 * an optional subtitle, actions and extra content (for example the reasons
 * a submission failed). Use it for "Order placed", "Payment failed" or a
 * 403 / 404 / 500 page; use EmptyState when a list simply has no data.
 *
 * ```tsx
 * <Result
 *   status="success"
 *   title="Order placed"
 *   subtitle="Order SO-1042 is waiting for payment."
 *   actions={<Button>View order</Button>}
 * />
 * ```
 */

export type ResultStatus = 'success' | 'error' | 'info' | 'warning' | '403' | '404' | '500'

export type ResultProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> & {
  status?: ResultStatus
  title?: React.ReactNode
  subtitle?: React.ReactNode
  icon?: React.ReactNode
  actions?: React.ReactNode
  size?: 'default' | 'compact'
  focusTitle?: boolean
}

type Eyes = 'happy' | 'cross' | 'dot' | 'closed' | 'side'
type Mouth = 'smile' | 'frown' | 'flat' | 'zigzag' | 'round'
type StatusLook = { eyes: Eyes; mouth: Mouth; live: 'status' | 'alert' }

const LOOKS: Record<ResultStatus, StatusLook> = {
  success: { eyes: 'happy', mouth: 'smile', live: 'status' },
  error: { eyes: 'cross', mouth: 'frown', live: 'alert' },
  info: { eyes: 'dot', mouth: 'round', live: 'status' },
  warning: { eyes: 'dot', mouth: 'zigzag', live: 'status' },
  '403': { eyes: 'closed', mouth: 'flat', live: 'status' },
  '404': { eyes: 'side', mouth: 'round', live: 'status' },
  '500': { eyes: 'cross', mouth: 'zigzag', live: 'alert' },
}

const EYES: Record<Eyes, React.ReactNode> = {
  happy: <path d="M14 22c1.5-3 4.5-3 6 0M28 22c1.5-3 4.5-3 6 0" />,
  cross: <path d="M14.5 17.5l5 5M19.5 17.5l-5 5M28.5 17.5l5 5M33.5 17.5l-5 5" />,
  dot: (
    <>
      <circle cx="17" cy="20" r="1.75" fill="currentColor" stroke="none" />
      <circle cx="31" cy="20" r="1.75" fill="currentColor" stroke="none" />
    </>
  ),
  closed: <path d="M14 20h6M28 20h6" />,
  side: (
    <>
      <circle cx="15" cy="20" r="1.75" fill="currentColor" stroke="none" />
      <circle cx="29" cy="20" r="1.75" fill="currentColor" stroke="none" />
    </>
  ),
}

const MOUTHS: Record<Mouth, React.ReactNode> = {
  smile: <path d="M18 29c3 3.5 9 3.5 12 0" />,
  frown: <path d="M18 32c3-3.5 9-3.5 12 0" />,
  flat: <path d="M19 31h10" />,
  zigzag: <path d="M17 31l3.5-2 3.5 2 3.5-2 3.5 2" />,
  round: <circle cx="24" cy="31" r="2.25" />,
}

function ResultFace({ eyes, mouth, className }: { eyes: Eyes; mouth: Mouth; className?: string }) {
  return (
    <svg viewBox="9 9 30 30" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className={className} data-slot="result-face" data-eyes={eyes} data-mouth={mouth}>
      {EYES[eyes]}
      {MOUTHS[mouth]}
    </svg>
  )
}

const DEFAULT_COPY: Partial<Record<ResultStatus, { title: [string, string]; subtitle: [string, string] }>> = {
  '403': {
    title: ['ui.result.forbidden.title', 'You do not have access to this page'],
    subtitle: ['ui.result.forbidden.subtitle', 'Ask an administrator for access, or go back to a page you can open.'],
  },
  '404': {
    title: ['ui.result.notFound.title', 'Page not found'],
    subtitle: ['ui.result.notFound.subtitle', 'The page was moved or deleted, or the link is incorrect.'],
  },
  '500': {
    title: ['ui.result.serverError.title', 'Something went wrong on our side'],
    subtitle: ['ui.result.serverError.subtitle', 'Try again in a moment. If the problem continues, contact support.'],
  },
}

export function resultLook(status: ResultStatus): StatusLook {
  return LOOKS[status]
}

export function Result({
  status = 'info',
  title,
  subtitle,
  icon,
  actions,
  size = 'default',
  focusTitle = false,
  className,
  children,
  ...props
}: ResultProps) {
  const t = useT()
  const look = LOOKS[status]
  const titleId = React.useId()
  const titleRef = React.useRef<HTMLHeadingElement>(null)
  const copy = DEFAULT_COPY[status]
  const resolvedTitle = title ?? (copy ? t(copy.title[0], copy.title[1]) : null)
  const resolvedSubtitle = subtitle ?? (copy && title === undefined ? t(copy.subtitle[0], copy.subtitle[1]) : null)
  const compact = size === 'compact'

  React.useEffect(() => {
    if (focusTitle) titleRef.current?.focus()
  }, [focusTitle])

  return (
    <div
      role={look.live}
      aria-labelledby={resolvedTitle ? titleId : undefined}
      data-slot="result"
      data-status={status}
      className={cn('flex flex-col items-center text-center', compact ? 'gap-3 px-panel py-card' : 'gap-4 px-card py-12', className)}
      {...props}
    >
      <span
        aria-hidden="true"
        data-slot="result-icon"
        className={cn('flex shrink-0 items-center justify-center rounded-2xl bg-muted text-foreground', compact ? 'size-14' : 'size-20')}
      >
        {icon ?? <ResultFace eyes={look.eyes} mouth={look.mouth} className={compact ? 'size-10' : 'size-14'} />}
      </span>
      {resolvedTitle ? (
        <h2
          ref={titleRef}
          id={titleId}
          tabIndex={focusTitle ? -1 : undefined}
          data-slot="result-title"
          className={cn('max-w-xl text-foreground outline-none', compact ? 'text-lg' : 'text-2xl tracking-tight')}
        >
          {resolvedTitle}
        </h2>
      ) : null}
      {resolvedSubtitle ? (
        <p data-slot="result-subtitle" className="max-w-xl text-sm text-muted-foreground">
          {resolvedSubtitle}
        </p>
      ) : null}
      {actions ? (
        <div data-slot="result-actions" className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {actions}
        </div>
      ) : null}
      {children ? (
        <div data-slot="result-content" className="mt-4 w-full max-w-xl rounded-card border border-border bg-muted/40 p-panel text-left text-sm">
          {children}
        </div>
      ) : null}
    </div>
  )
}
