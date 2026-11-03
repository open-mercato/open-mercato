"use client"

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@open-mercato/shared/lib/utils'

/**
 * User / entity avatar with auto-generated initials, optional photo,
 * optional icon override, optional **status indicator** (online/away/
 * busy/away dot per Figma `Bottom Status [1.1]`), optional **badge**
 * slot for top-right affordances (verified check, premium icon, X to
 * remove — per Figma `Top Status [1.1]`), and optional outer **ring**
 * (accent / status-colored).
 *
 * Phase B.4 rewrite per Figma `Avatars` page (`210:4129`):
 * - `Avatar [1.1]` (`245:18786`)
 * - `Bottom Status [1.1]` (`245:18721`) — 5 dot tones
 * - `Top Status [1.1]` (`245:18697`) — 6 icon-badge variants
 * - `Avatar Group [1.1]` (`581:6198`) + `Compact Avatar Group [1.1]`
 *   (`2906:14962`) — see `AvatarStack`.
 *
 * Backward compatibility (5 import sites — customers linking
 * adapters + LinkEntityDialog + ds-v5 demo): existing
 * `<Avatar src label size variant icon />` API stays callable
 * verbatim. New optional props (`status`, `statusPosition`, `ring`,
 * `badge`, `badgeClassName`) are additive.
 */

const avatarVariants = cva(
  'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold select-none',
  {
    variants: {
      size: {
        xs: 'size-5 text-xs',
        sm: 'size-7 text-xs',
        md: 'size-9 text-sm',
        lg: 'size-12 text-base',
        xl: 'size-16 text-xl',
        20: 'size-5 text-xs font-medium',
        24: 'size-6 text-xs font-medium',
        32: 'size-8 text-sm font-medium',
        40: 'size-10 text-base font-medium',
        48: 'size-12 text-lg leading-6 font-medium',
        56: 'size-14 text-lg leading-6 font-medium',
        64: 'size-16 text-2xl font-medium',
        72: 'size-18 text-2xl font-medium',
        80: 'size-20 text-2xl font-medium',
      },
      variant: {
        default: 'bg-primary/10 text-primary',
        monochrome: 'bg-muted text-muted-foreground',
      },
    },
    defaultVariants: {
      size: 'md',
      variant: 'default',
    },
  },
)

function computeInitials(label: string): string {
  const trimmed = label.trim()
  if (!trimmed.length) return '?'
  const parts = trimmed.split(/\s+/).filter(Boolean)
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase()
  }
  const first = parts[0][0] ?? ''
  const last = parts[parts.length - 1][0] ?? ''
  return (first + last).toUpperCase()
}

// Status tone → background color class. Surface stays opaque + ringed
// by the page background (`ring-background`) so the badge reads as
// an overlay on top of the avatar circle.
export type AvatarStatus =
  | 'online'
  | 'offline'
  | 'busy'
  | 'away'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'

const AVATAR_STATUS_BG: Record<AvatarStatus, string> = {
  online: 'bg-status-success-icon',
  offline: 'bg-muted-foreground',
  busy: 'bg-status-error-icon',
  away: 'bg-status-warning-icon',
  success: 'bg-status-success-icon',
  warning: 'bg-status-warning-icon',
  error: 'bg-status-error-icon',
  info: 'bg-status-info-icon',
}

// Status dot size per avatar size — slightly less than 1/3 of the
// avatar diameter so the dot reads but doesn't overpower.
const AVATAR_STATUS_SIZE: Record<NonNullable<VariantProps<typeof avatarVariants>['size']>, string> = {
  xs: 'size-1.5',
  sm: 'size-2',
  md: 'size-2.5',
  lg: 'size-3',
  xl: 'size-4',
  20: 'size-2.5',
  24: 'size-3',
  32: 'size-4',
  40: 'size-4.5',
  48: 'size-5',
  56: 'size-6',
  64: 'size-7',
  72: 'size-8',
  80: 'size-8',
}

const AVATAR_BADGE_SIZE = {
  ...AVATAR_STATUS_SIZE,
  xs: 'size-3.5',
  sm: 'size-3.5',
  md: 'size-4',
  lg: 'size-5',
  xl: 'size-6',
}

// Outer ring tones (story-style highlight, selected, status outline).
export type AvatarRingTone = 'accent' | 'success' | 'warning' | 'error' | 'muted'

const AVATAR_RING_CLASS: Record<AvatarRingTone, string> = {
  accent: 'ring-2 ring-accent-indigo ring-offset-2 ring-offset-background',
  success: 'ring-2 ring-status-success-icon ring-offset-2 ring-offset-background',
  warning: 'ring-2 ring-status-warning-icon ring-offset-2 ring-offset-background',
  error: 'ring-2 ring-status-error-icon ring-offset-2 ring-offset-background',
  muted: 'ring-2 ring-input ring-offset-2 ring-offset-background',
}

export type AvatarProps = {
  label: string
  src?: string | null
  icon?: React.ReactNode
  ariaLabel?: string
  /** Bottom-right (default) or top-right status dot. */
  status?: AvatarStatus
  /** Where the status dot sits. @default 'bottom-right' */
  statusPosition?: 'bottom-right' | 'top-right'
  /** Outer ring affordance — pass `true` for accent (alias for
   * `'accent'`) or a specific tone. */
  ring?: boolean | AvatarRingTone
  /** Custom top-right badge slot — overrides `status` when both are
   * set with `statusPosition='top-right'`. Use for verified check
   * icons, premium markers, "X to remove" affordances per Figma
   * `Top Status [1.1]`. The badge content is rendered inside a
   * `rounded-full ring-2 ring-background` shell sized relative to
   * the avatar — pass a simple icon (`<Check className="size-3" />`)
   * for the cleanest look. */
  badge?: React.ReactNode
  /** Override the badge wrapper className (size, bg, etc.). */
  badgeClassName?: string
} & VariantProps<typeof avatarVariants> &
  Omit<React.HTMLAttributes<HTMLDivElement>, 'role' | 'aria-label'>

type AvatarCircleProps = Omit<
  AvatarProps,
  'status' | 'statusPosition' | 'ring' | 'badge' | 'badgeClassName'
> & {
  className?: string
}

// Inner div (the actual avatar circle). Implemented as forwardRef so
// the outer Avatar wrapper can forward refs through to the rendered
// `<div role="img">` regardless of whether it lives directly inside
// Avatar or inside the decorated `<span data-slot="avatar-root">`
// wrapper.
const AvatarCircle = React.forwardRef<HTMLDivElement, AvatarCircleProps>(function AvatarCircle(
  { className, label, src, icon, size, variant, ariaLabel, ...rest },
  ref,
) {
  const initials = React.useMemo(() => {
    const letters = computeInitials(label)
    return typeof size === 'number' && size <= 32 ? letters.slice(0, 1) : letters
  }, [label, size])
  return (
    <div
      ref={ref}
      role="img"
      aria-label={ariaLabel ?? label}
      data-slot="avatar"
      className={cn(avatarVariants({ size, variant }), className)}
      {...rest}
    >
      {src ? (
        <img src={src} alt="" className="size-full object-cover" aria-hidden="true" />
      ) : icon ? (
        <span aria-hidden="true" data-slot="avatar-icon" className="flex size-full items-center justify-center [&>svg]:size-1/2">
          {icon}
        </span>
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
    </div>
  )
})

export const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>((props, ref) => {
  const {
    className,
    label,
    src,
    icon,
    size = 'md',
    variant,
    ariaLabel,
    status,
    statusPosition = 'bottom-right',
    ring,
    badge,
    badgeClassName,
    ...rest
  } = props

  const resolvedRingTone: AvatarRingTone | null = ring === true ? 'accent' : ring || null
  const showStatus = status !== undefined
  const showBadge =
    badge !== undefined && (statusPosition === 'top-right' || !showStatus)
  const showTopStatus = showStatus && statusPosition === 'top-right' && !showBadge
  const showBottomStatus = showStatus && statusPosition === 'bottom-right' && badge === undefined

  // Plain avatar (no overlay decorations) — preserve the original
  // single-element output for backward compat.
  if (!showStatus && !showBadge && !resolvedRingTone) {
    return (
      <AvatarCircle
        ref={ref as React.Ref<HTMLDivElement>}
        className={className}
        label={label}
        src={src}
        icon={icon}
        size={size}
        variant={variant}
        ariaLabel={ariaLabel}
        {...rest}
      />
    )
  }

  const ringClass = resolvedRingTone ? AVATAR_RING_CLASS[resolvedRingTone] : ''
  const statusSize = AVATAR_STATUS_SIZE[size ?? 'md']
  const statusPositionClass =
    statusPosition === 'top-right'
      ? '-right-0 -top-0 translate-x-1/4 -translate-y-1/4'
      : '-right-0 -bottom-0 translate-x-1/4 translate-y-1/4'
  const badgePositionClass = '-right-0 -top-0 translate-x-1/4 -translate-y-1/4'

  return (
    <span
      data-slot="avatar-root"
      className={cn('relative inline-flex shrink-0 rounded-full', ringClass)}
    >
      <AvatarCircle
        ref={ref as React.Ref<HTMLDivElement>}
        className={className}
        label={label}
        src={src}
        icon={icon}
        size={size}
        variant={variant}
        ariaLabel={ariaLabel}
        {...rest}
      />
      {showBottomStatus || showTopStatus ? (
        <span
          data-slot="avatar-status"
          data-status={status}
          data-position={statusPosition}
          aria-hidden="true"
          className={cn(
            'absolute inline-block rounded-full ring-2 ring-background',
            statusSize,
            AVATAR_STATUS_BG[status as AvatarStatus],
            statusPositionClass,
          )}
        />
      ) : null}
      {showBadge ? (
        <span
          data-slot="avatar-badge"
          aria-hidden="true"
          className={cn(
            'absolute inline-flex items-center justify-center rounded-full ring-2 ring-background bg-background text-foreground',
            AVATAR_BADGE_SIZE[size ?? 'md'],
            badgePositionClass,
            badgeClassName,
          )}
        >
          {badge}
        </span>
      ) : null}
    </span>
  )
})

Avatar.displayName = 'Avatar'

export { avatarVariants }

export type AvatarStackProps = {
  children: React.ReactNode
  max?: number
  size?: VariantProps<typeof avatarVariants>['size']
  className?: string
  /**
   * Additional hidden items not represented by `children` — e.g. a server-truncated list that
   * already returned only the top N owners. Added to the children-derived overflow so the
   * "+N" badge reflects the true number of omitted items, not just the ones dropped locally.
   */
  overflowCount?: number
}

type AvatarSize = NonNullable<AvatarProps['size']>
type AvatarStackOverlap = 0 | 4 | 6 | 8 | 12 | 16

const AVATAR_STACK_OVERLAP: Record<AvatarSize, AvatarStackOverlap> = {
  xs: 0,
  sm: 4,
  md: 6,
  lg: 12,
  xl: 12,
  20: 4,
  24: 4,
  32: 6,
  40: 12,
  48: 12,
  56: 16,
  64: 16,
  72: 16,
  80: 16,
}

const AVATAR_STACK_TEXT_OVERLAP: Record<AvatarSize, AvatarStackOverlap> = {
  ...AVATAR_STACK_OVERLAP,
  40: 6,
  48: 8,
  56: 12,
  64: 12,
}

const AVATAR_STACK_OVERLAP_CLASS: Record<AvatarStackOverlap, string> = {
  0: 'ml-0',
  4: '-ml-1',
  6: '-ml-1.5',
  8: '-ml-2',
  12: '-ml-3',
  16: '-ml-4',
}

const AVATAR_STACK_MIN_WIDTH: Record<AvatarSize, string> = {
  xs: 'min-w-5',
  sm: 'min-w-7',
  md: 'min-w-9',
  lg: 'min-w-12',
  xl: 'min-w-16',
  20: 'min-w-5',
  24: 'min-w-6',
  32: 'min-w-8',
  40: 'min-w-10',
  48: 'min-w-12',
  56: 'min-w-14',
  64: 'min-w-16',
  72: 'min-w-18',
  80: 'min-w-20',
}

function AvatarStackItem({ children, overlap, previousOverlap }: {
  children: React.ReactNode
  overlap: AvatarStackOverlap
  previousOverlap?: AvatarStackOverlap
}) {
  const resolvedOverlap = previousOverlap === undefined ? 0 : Math.min(previousOverlap, overlap) as AvatarStackOverlap
  return (
    <span
      data-slot="avatar-stack-item"
      className={cn(
        'relative inline-flex shrink-0 rounded-full bg-background [&_[data-slot=avatar]]:ring-2 [&_[data-slot=avatar]]:ring-inset [&_[data-slot=avatar]]:ring-background',
        previousOverlap !== undefined && AVATAR_STACK_OVERLAP_CLASS[resolvedOverlap],
      )}
    >
      {children}
    </span>
  )
}

export function AvatarStack({ children, max = 4, size = 'md', className, overflowCount = 0 }: AvatarStackProps) {
  const items = React.Children.toArray(children)
  const visible = items.slice(0, max)
  const overflow = Math.max(0, items.length - max) + Math.max(0, overflowCount)
  const resolvedSize = size ?? 'md'
  const overflowLabel = `+${overflow}`
  const visibleOverlaps = visible.map((item) => {
    if (!React.isValidElement<AvatarProps>(item) || item.type !== Avatar) return AVATAR_STACK_OVERLAP[resolvedSize]
    const itemSize = item.props.size ?? 'md'
    return !item.props.src && !item.props.icon ? AVATAR_STACK_TEXT_OVERLAP[itemSize] : AVATAR_STACK_OVERLAP[itemSize]
  })

  return (
    <div
      data-slot="avatar-stack"
      className={cn('flex items-center', className)}
    >
      {visible.map((item, index) => (
        <AvatarStackItem key={React.isValidElement(item) ? item.key : index} overlap={visibleOverlaps[index]} previousOverlap={visibleOverlaps[index - 1]}>
          {item}
        </AvatarStackItem>
      ))}
      {overflow > 0 && (
        <AvatarStackItem overlap={AVATAR_STACK_TEXT_OVERLAP[resolvedSize]} previousOverlap={visibleOverlaps[visible.length - 1]}>
          <Avatar
            label={overflowLabel}
            icon={<span>{overflowLabel}</span>}
            size={resolvedSize}
            variant="monochrome"
            className={cn('w-auto px-1', AVATAR_STACK_MIN_WIDTH[resolvedSize])}
          />
        </AvatarStackItem>
      )}
    </div>
  )
}
