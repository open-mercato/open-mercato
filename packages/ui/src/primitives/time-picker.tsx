"use client"

import * as React from 'react'
import { Check, ChevronLeft, ChevronRight, Clock, X } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from './button'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

export type TimePickerValue = string | null

export type TimePickerStatusVariant = 'available' | 'busy' | 'in-meeting' | 'offline'

type SlotInteractiveState = 'default' | 'hover' | 'active' | 'disabled'
type DurationInteractiveState = SlotInteractiveState
type StatusInteractiveState = 'default' | 'hover' | 'selected' | 'disabled'

type TimeFormat = '12h' | '24h'

type LegacyFooterAction = {
  label: string
  onClick: () => void
  variant?: 'link' | 'muted'
}

type PinnedTopAction = {
  label: string
  onClick: () => void
  icon?: React.ReactNode
  /** Optional secondary text rendered right-aligned (e.g. the current time next to `Now`). */
  rightText?: string
}

type DurationOption = {
  value: number
  label?: string
  disabled?: boolean
}

type StatusOption = {
  variant: TimePickerStatusVariant
  label?: string
  disabled?: boolean
}

function padTwo(input: number): string {
  return String(input).padStart(2, '0')
}

function parseTime(value: string | null | undefined): { hour: number; minute: number } | null {
  if (!value) return null
  const parts = value.split(':')
  if (parts.length < 2) return null
  const hour = parseInt(parts[0] ?? '0', 10)
  const minute = parseInt(parts[1] ?? '0', 10)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  return {
    hour: Math.max(0, Math.min(23, hour)),
    minute: Math.max(0, Math.min(59, minute)),
  }
}

function formatSlotDisplay(value: string, format: TimeFormat): { main: string; suffix: string | null } {
  const parsed = parseTime(value)
  if (!parsed) return { main: value, suffix: null }
  if (format === '24h') {
    return { main: `${padTwo(parsed.hour)}:${padTwo(parsed.minute)}`, suffix: null }
  }
  const hour12 = parsed.hour === 0 ? 12 : parsed.hour > 12 ? parsed.hour - 12 : parsed.hour
  const suffix = parsed.hour < 12 ? 'AM' : 'PM'
  return { main: `${padTwo(hour12)}:${padTwo(parsed.minute)}`, suffix }
}

function generateSlots(startTime: string, endTime: string, intervalMinutes: number): string[] {
  const start = parseTime(startTime)
  const end = parseTime(endTime)
  if (!start || !end) return []
  const step = intervalMinutes > 0 ? intervalMinutes : 30
  const out: string[] = []
  const startTotal = start.hour * 60 + start.minute
  const endTotal = end.hour * 60 + end.minute
  if (endTotal < startTotal) return []
  for (let m = startTotal; m <= endTotal; m += step) {
    const h = Math.floor(m / 60)
    const min = m % 60
    out.push(`${padTwo(h)}:${padTwo(min)}`)
  }
  return out
}

/**
 * Format an HH:MM 24h string for display, splitting into the main digits and an
 * optional AM/PM suffix. Exported so consumers (e.g. the legacy `backend/inputs/TimePicker`
 * shim) can render their trigger label in the same format as the slot list.
 */
export function formatTimePickerDisplay(
  value: string,
  format: '12h' | '24h' = '12h',
): { main: string; suffix: string | null } {
  return formatSlotDisplay(value, format)
}

export function formatDuration(minutes: number, options?: { short?: boolean }): string {
  const short = options?.short ?? true
  if (!Number.isFinite(minutes) || minutes <= 0) return short ? '0 min' : '0 minutes'
  if (minutes < 60) return short ? `${minutes} min` : `${minutes} minutes`
  if (minutes % (24 * 60) === 0) {
    const days = minutes / (24 * 60)
    return short ? (days === 1 ? '1 day' : `${days} days`) : days === 1 ? '1 day' : `${days} days`
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60
    return short ? (hours === 1 ? '1 hour' : `${hours} hours`) : hours === 1 ? '1 hour' : `${hours} hours`
  }
  const hours = Math.floor(minutes / 60)
  const rest = minutes - hours * 60
  return short
    ? `${hours}h ${rest}m`
    : `${hours} hour${hours === 1 ? '' : 's'} ${rest} minute${rest === 1 ? '' : 's'}`
}

const defaultStatusLabels: Record<TimePickerStatusVariant, string> = {
  available: 'Available',
  busy: 'Busy',
  'in-meeting': 'In meeting',
  offline: 'Offline',
}

const statusColorMap: Record<
  TimePickerStatusVariant,
  { dot: string; bgSoft: string; border: string; text: string }
> = {
  available: {
    dot: 'bg-status-success-icon',
    bgSoft: 'bg-status-success-bg',
    border: 'border-status-success-border',
    text: 'text-status-success-text',
  },
  busy: {
    dot: 'bg-status-error-icon',
    bgSoft: 'bg-status-error-bg',
    border: 'border-status-error-border',
    text: 'text-status-error-text',
  },
  'in-meeting': {
    dot: 'bg-status-warning-icon',
    bgSoft: 'bg-status-warning-bg',
    border: 'border-status-warning-border',
    text: 'text-status-warning-text',
  },
  offline: {
    dot: 'bg-muted-foreground',
    bgSoft: 'bg-muted',
    border: 'border-border',
    text: 'text-muted-foreground',
  },
}

const slotVariants = cva(
  'flex h-9 w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors text-left',
  {
    variants: {
      state: {
        default: 'bg-background hover:bg-muted/50 text-muted-foreground cursor-pointer',
        hover: 'bg-muted/50 text-muted-foreground cursor-pointer',
        active: 'bg-brand-violet/10 text-brand-violet cursor-pointer',
        disabled: 'bg-background text-muted-foreground/40 cursor-not-allowed',
      },
    },
    defaultVariants: { state: 'default' },
  },
)

export type TimePickerSlotProps = {
  value: string
  label?: string
  rightText?: string
  state?: SlotInteractiveState
  selected?: boolean
  disabled?: boolean
  format?: TimeFormat
  onSelect?: (value: string) => void
  className?: string
  'aria-label'?: string
}

export const TimePickerSlot = React.forwardRef<HTMLButtonElement, TimePickerSlotProps>(
  (
    {
      value,
      label,
      rightText,
      state,
      selected,
      disabled,
      format = '12h',
      onSelect,
      className,
      'aria-label': ariaLabel,
    },
    ref,
  ) => {
    const effectiveState: SlotInteractiveState = disabled
      ? 'disabled'
      : selected
        ? 'active'
        : (state ?? 'default')
    const display = label != null ? { main: label, suffix: null as string | null } : formatSlotDisplay(value, format)
    const right = rightText ? formatSlotDisplay(rightText, format) : null
    const isInteractive = effectiveState !== 'disabled'

    return (
      <button
        ref={ref}
        type="button"
        className={cn(slotVariants({ state: effectiveState }), className)}
        onClick={isInteractive ? () => onSelect?.(value) : undefined}
        disabled={!isInteractive}
        aria-label={ariaLabel ?? value}
        aria-pressed={effectiveState === 'active'}
        data-slot="time-picker-slot"
        data-state={effectiveState}
      >
        <span className="flex min-w-0 flex-1 items-center gap-1">
          <span>{display.main}</span>
          {display.suffix ? (
            <span className={effectiveState === 'active' ? 'text-brand-violet/60' : 'text-muted-foreground/60'}>
              {display.suffix}
            </span>
          ) : null}
        </span>
        {right ? (
          <span className="flex min-w-0 items-center justify-end gap-1">
            <span>{right.main}</span>
            {right.suffix ? (
              <span className={effectiveState === 'active' ? 'text-brand-violet/60' : 'text-muted-foreground/60'}>
                {right.suffix}
              </span>
            ) : null}
          </span>
        ) : null}
        {effectiveState === 'active' ? (
          <Check className="size-3.5 shrink-0 text-brand-violet" aria-hidden="true" />
        ) : null}
      </button>
    )
  },
)
TimePickerSlot.displayName = 'TimePickerSlot'

const durationChipVariants = cva(
  'inline-flex h-7 items-center justify-center gap-1.5 rounded-lg px-2.5 text-sm font-medium transition-colors whitespace-nowrap',
  {
    variants: {
      state: {
        default:
          'bg-background border border-border shadow-xs text-muted-foreground hover:bg-muted/40 cursor-pointer',
        hover: 'bg-muted/40 border border-border text-muted-foreground cursor-pointer',
        active: 'bg-brand-violet/10 text-brand-violet cursor-pointer',
        disabled:
          'bg-background border border-border text-muted-foreground/40 cursor-not-allowed shadow-xs',
      },
    },
    defaultVariants: { state: 'default' },
  },
)

export type TimePickerDurationChipProps = {
  value: number
  label?: string
  state?: DurationInteractiveState
  selected?: boolean
  disabled?: boolean
  onSelect?: (value: number) => void
  className?: string
}

export const TimePickerDurationChip = React.forwardRef<HTMLButtonElement, TimePickerDurationChipProps>(
  (
    { value, label, state, selected, disabled, onSelect, className },
    ref,
  ) => {
    const effectiveState: DurationInteractiveState = disabled
      ? 'disabled'
      : selected
        ? 'active'
        : (state ?? 'default')
    const isInteractive = effectiveState !== 'disabled'
    const displayLabel = label ?? formatDuration(value)
    return (
      <button
        ref={ref}
        type="button"
        className={cn(durationChipVariants({ state: effectiveState }), className)}
        onClick={isInteractive ? () => onSelect?.(value) : undefined}
        disabled={!isInteractive}
        aria-pressed={effectiveState === 'active'}
        data-slot="time-picker-duration-chip"
        data-state={effectiveState}
      >
        {effectiveState === 'active' ? (
          <Check className="size-3 shrink-0" aria-hidden="true" />
        ) : null}
        <span>{displayLabel}</span>
      </button>
    )
  },
)
TimePickerDurationChip.displayName = 'TimePickerDurationChip'

const statusChipBaseVariants = cva(
  'inline-flex h-7 items-center justify-center gap-1.5 rounded-lg px-2.5 text-sm font-medium transition-colors whitespace-nowrap border',
  {
    variants: {
      state: {
        default: '',
        hover: '',
        selected: '',
        disabled: 'cursor-not-allowed opacity-60',
      },
    },
    defaultVariants: { state: 'default' },
  },
)

export type TimePickerStatusChipProps = {
  variant: TimePickerStatusVariant
  label?: string
  state?: StatusInteractiveState
  selected?: boolean
  disabled?: boolean
  icon?: React.ReactNode
  onSelect?: (variant: TimePickerStatusVariant) => void
  className?: string
}

export const TimePickerStatusChip = React.forwardRef<HTMLButtonElement, TimePickerStatusChipProps>(
  (
    { variant, label, state, selected, disabled, icon, onSelect, className },
    ref,
  ) => {
    const effectiveState: StatusInteractiveState = disabled
      ? 'disabled'
      : selected
        ? 'selected'
        : (state ?? 'default')
    const colors = statusColorMap[variant]
    const isInteractive = effectiveState !== 'disabled'
    const displayLabel = label ?? defaultStatusLabels[variant]

    const stateClasses =
      effectiveState === 'selected'
        ? cn(colors.bgSoft, colors.border, colors.text)
        : effectiveState === 'hover'
          ? cn('bg-muted/30 border-border', colors.text, 'cursor-pointer')
          : effectiveState === 'disabled'
            ? cn('bg-background border-border', colors.text)
            : cn('bg-background border-border text-muted-foreground hover:bg-muted/30 cursor-pointer')

    return (
      <button
        ref={ref}
        type="button"
        className={cn(statusChipBaseVariants({ state: effectiveState }), stateClasses, className)}
        onClick={isInteractive ? () => onSelect?.(variant) : undefined}
        disabled={!isInteractive}
        aria-pressed={effectiveState === 'selected'}
        data-slot="time-picker-status-chip"
        data-state={effectiveState}
        data-variant={variant}
      >
        {icon ?? (
          <span
            className={cn('inline-block size-1.5 shrink-0 rounded-full', colors.dot)}
            aria-hidden="true"
          />
        )}
        <span>{displayLabel}</span>
      </button>
    )
  },
)
TimePickerStatusChip.displayName = 'TimePickerStatusChip'

/**
 * Wraps a horizontally-scrollable row with prev/next arrow buttons that appear
 * only when overflow is present. Hides the native scrollbar and reserves padding
 * on each side proportional to the visible arrow so chips never sit underneath
 * the arrow button. Exported for consumers that need the same UX (e.g. inline
 * duration chip row inside a meeting/activity form).
 */
export function HorizontalScrollRow({
  className,
  contentClassName,
  children,
  ariaLabel,
  arrowSize = 'default',
  scrollLeftAriaLabel = 'Scroll left',
  scrollRightAriaLabel = 'Scroll right',
}: {
  className?: string
  /** Override classes for the inner scroll container (e.g. tighter padding when inlined into a form row). */
  contentClassName?: string
  children: React.ReactNode
  ariaLabel?: string
  /** Arrow button size. `default` = 28px circle, `sm` = 24px (denser rows). */
  arrowSize?: 'default' | 'sm'
  /** Override the left arrow's aria-label. Default is English 'Scroll left'. */
  scrollLeftAriaLabel?: string
  /** Override the right arrow's aria-label. Default is English 'Scroll right'. */
  scrollRightAriaLabel?: string
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = React.useState(false)
  const [canScrollRight, setCanScrollRight] = React.useState(false)

  const refreshScrollState = React.useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const { scrollLeft, scrollWidth, clientWidth } = el
    setCanScrollLeft(scrollLeft > 1)
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 1)
  }, [])

  React.useEffect(() => {
    refreshScrollState()
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', refreshScrollState, { passive: true })
    const ro = new ResizeObserver(refreshScrollState)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', refreshScrollState)
      ro.disconnect()
    }
  }, [refreshScrollState])

  const scrollBy = React.useCallback((direction: 'left' | 'right') => {
    const el = scrollRef.current
    if (!el) return
    const amount = Math.max(80, Math.floor(el.clientWidth * 0.6))
    el.scrollBy({ left: direction === 'left' ? -amount : amount, behavior: 'smooth' })
  }, [])

  const arrowButtonClass =
    arrowSize === 'sm' ? 'size-6 [&_svg]:size-3.5' : 'size-7 [&_svg]:size-4'

  return (
    <div className={cn('relative', className)} data-slot="time-picker-scroll-row">
      {/* Outer gutter — reserves room for the absolute-positioned chevron buttons.
          The scroll viewport lives INSIDE this gutter so chips can never slide
          underneath the arrows — moving scroll offsets only shift content inside
          the viewport, not the chevron clearance. */}
      <div
        className={cn(
          'transition-[padding]',
          canScrollLeft ? 'pl-9' : 'pl-4',
          canScrollRight ? 'pr-9' : 'pr-4',
        )}
      >
        <div
          ref={scrollRef}
          className={cn(
            'flex items-center gap-2 overflow-x-auto py-3.5',
            '[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
            contentClassName,
          )}
          role="group"
          aria-label={ariaLabel}
        >
          {children}
        </div>
      </div>
      {/* Edge fades — soft gradient at the boundary between the gutter and the
          scroll viewport, so chips sliding into the viewport dissolve cleanly
          before reaching the arrow's edge. */}
      {canScrollLeft ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-9 w-6 bg-gradient-to-r from-background to-transparent"
        />
      ) : null}
      {canScrollRight ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-9 w-6 bg-gradient-to-l from-background to-transparent"
        />
      ) : null}
      {canScrollLeft ? (
        <button
          type="button"
          onClick={() => scrollBy('left')}
          aria-label={scrollLeftAriaLabel}
          className={cn(
            'absolute left-1 top-1/2 z-10 flex -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-xs transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
            arrowButtonClass,
          )}
          data-slot="time-picker-scroll-left"
        >
          <ChevronLeft aria-hidden="true" />
        </button>
      ) : null}
      {canScrollRight ? (
        <button
          type="button"
          onClick={() => scrollBy('right')}
          aria-label={scrollRightAriaLabel}
          className={cn(
            'absolute right-1 top-1/2 z-10 flex -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-xs transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
            arrowButtonClass,
          )}
          data-slot="time-picker-scroll-right"
        >
          <ChevronRight aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}

function useControllable<T>(controlled: T | undefined, defaultValue: T, onChange?: (next: T) => void) {
  const [internal, setInternal] = React.useState<T>(defaultValue)
  const isControlled = controlled !== undefined
  const value = isControlled ? (controlled as T) : internal
  const setValue = React.useCallback(
    (next: T) => {
      if (!isControlled) setInternal(next)
      onChange?.(next)
    },
    [isControlled, onChange],
  )
  return [value, setValue] as const
}

export type TimePickerProps = {
  value?: TimePickerValue
  defaultValue?: TimePickerValue
  onChange?: (value: TimePickerValue) => void

  showHeader?: boolean
  headerIcon?: React.ReactNode
  headerTitle?: string
  headerPlaceholder?: string
  onClose?: () => void

  durations?: DurationOption[]
  activeDuration?: number
  defaultActiveDuration?: number
  onDurationChange?: (value: number) => void

  statuses?: StatusOption[]
  activeStatus?: TimePickerStatusVariant
  defaultActiveStatus?: TimePickerStatusVariant
  onStatusChange?: (variant: TimePickerStatusVariant) => void
  statusLabel?: string

  slots?: string[]
  startTime?: string
  endTime?: string
  intervalMinutes?: number
  format?: TimeFormat
  slotRightText?: (slot: string) => string | undefined
  slotLabel?: string
  maxHeight?: number

  showFooter?: boolean
  cancelLabel?: string
  applyLabel?: string
  onCancel?: () => void
  onApply?: (value: TimePickerValue) => void
  legacyFooterActions?: LegacyFooterAction[]
  /**
   * Quick-action rows rendered above the scrollable slot list — used for
   * "Now"-style shortcuts that stay visible regardless of scroll position.
   * Styled like slots but with primary-tinted foreground.
   */
  pinnedTopActions?: PinnedTopAction[]

  trigger?: React.ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  popoverAlign?: 'start' | 'center' | 'end'
  popoverSide?: 'top' | 'right' | 'bottom' | 'left'

  className?: string
  disabled?: boolean
  'aria-label'?: string
}

function TimePickerCard({
  value,
  setValue,
  showHeader,
  headerIcon,
  headerTitle,
  headerPlaceholder,
  onClose,
  closeAriaLabel,
  format,
  durationOptions,
  activeDuration,
  setActiveDuration,
  onDurationChange,
  durationsAriaLabel,
  scrollLeftAriaLabel,
  scrollRightAriaLabel,
  statusOptions,
  activeStatus,
  setActiveStatus,
  onStatusChange,
  statusLabel,
  slotList,
  slotLabel,
  slotRightText,
  maxHeight,
  showFooter,
  cancelLabel,
  applyLabel,
  handleCancel,
  handleApply,
  legacyFooterActions,
  pinnedTopActions,
  disabled,
  className,
  ariaLabel,
  slotListRef,
}: {
  value: TimePickerValue
  setValue: (next: TimePickerValue) => void
  showHeader: boolean
  headerIcon: React.ReactNode
  headerTitle: string | undefined
  headerPlaceholder: string
  onClose: (() => void) | undefined
  closeAriaLabel: string
  format: TimeFormat
  durationOptions: DurationOption[] | undefined
  activeDuration: number | undefined
  setActiveDuration: (next: number) => void
  onDurationChange: ((value: number) => void) | undefined
  durationsAriaLabel: string
  scrollLeftAriaLabel: string
  scrollRightAriaLabel: string
  statusOptions: StatusOption[] | undefined
  activeStatus: TimePickerStatusVariant | undefined
  setActiveStatus: (next: TimePickerStatusVariant) => void
  onStatusChange: ((variant: TimePickerStatusVariant) => void) | undefined
  statusLabel: string
  slotList: string[]
  slotLabel: string | undefined
  slotRightText: ((slot: string) => string | undefined) | undefined
  maxHeight: number
  showFooter: boolean
  cancelLabel: string
  applyLabel: string
  handleCancel: () => void
  handleApply: () => void
  legacyFooterActions: LegacyFooterAction[] | undefined
  pinnedTopActions: PinnedTopAction[] | undefined
  disabled: boolean
  className: string | undefined
  ariaLabel: string
  slotListRef: React.RefObject<HTMLDivElement | null>
}) {
  const headerDisplay = React.useMemo(() => {
    if (headerTitle != null) return { main: headerTitle, suffix: null as string | null }
    if (value) return formatSlotDisplay(value, format)
    return { main: headerPlaceholder, suffix: null as string | null }
  }, [headerTitle, value, format, headerPlaceholder])

  const handleSlotKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return
      const target = event.target as HTMLElement
      const slotButton = target.closest<HTMLButtonElement>('[data-slot="time-picker-slot"]')
      if (!slotButton) return
      const container = slotListRef.current
      if (!container) return
      const all = Array.from(
        container.querySelectorAll<HTMLButtonElement>('[data-slot="time-picker-slot"]:not(:disabled)'),
      )
      const currentIndex = all.indexOf(slotButton)
      if (currentIndex === -1) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        const next = all[Math.min(all.length - 1, currentIndex + 1)]
        next?.focus()
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        const prev = all[Math.max(0, currentIndex - 1)]
        prev?.focus()
      } else if (event.key === 'Home') {
        event.preventDefault()
        all[0]?.focus()
      } else if (event.key === 'End') {
        event.preventDefault()
        all[all.length - 1]?.focus()
      }
    },
    [disabled, slotListRef],
  )

  return (
    <div
      className={cn(
        'flex w-[348px] flex-col overflow-hidden rounded-[20px] border border-border bg-background',
        'shadow-[0px_1px_2px_0px_rgba(10,13,20,0.03),0px_24px_24px_-12px_rgba(51,51,51,0.04),0px_12px_12px_-6px_rgba(51,51,51,0.04)]',
        className,
      )}
      role="dialog"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      data-slot="time-picker"
    >
      {showHeader ? (
        <div
          className="flex items-center gap-2 border-b border-border px-4 py-3.5"
          data-slot="time-picker-header"
        >
          <span className="flex shrink-0 items-center text-muted-foreground" aria-hidden="true">
            {headerIcon ?? <Clock className="size-5" aria-hidden="true" />}
          </span>
          <p className="flex-1 min-w-0 truncate text-base font-medium text-muted-foreground">
            <span>{headerDisplay.main}</span>
            {headerDisplay.suffix ? <span className="ml-1 text-muted-foreground/60">{headerDisplay.suffix}</span> : null}
          </p>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              disabled={disabled}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 disabled:pointer-events-none disabled:opacity-60"
              aria-label={closeAriaLabel}
              data-slot="time-picker-close"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}

      {durationOptions && durationOptions.length > 0 ? (
        <HorizontalScrollRow
          className="border-b border-border"
          ariaLabel={durationsAriaLabel}
          scrollLeftAriaLabel={scrollLeftAriaLabel}
          scrollRightAriaLabel={scrollRightAriaLabel}
        >
          {durationOptions.map((option) => (
            <TimePickerDurationChip
              key={option.value}
              value={option.value}
              label={option.label}
              disabled={disabled || option.disabled}
              selected={activeDuration === option.value}
              onSelect={(next) => {
                setActiveDuration(next)
                onDurationChange?.(next)
              }}
            />
          ))}
        </HorizontalScrollRow>
      ) : null}

      {statusOptions && statusOptions.length > 0 ? (
        <div
          className="flex flex-col gap-2 border-b border-border px-4 py-3.5"
          data-slot="time-picker-status-row"
        >
          <p className="text-sm font-medium text-muted-foreground">{statusLabel}</p>
          <div className="flex flex-wrap items-center gap-2">
            {statusOptions.map((option) => (
              <TimePickerStatusChip
                key={option.variant}
                variant={option.variant}
                label={option.label}
                disabled={disabled || option.disabled}
                selected={activeStatus === option.variant}
                onSelect={(next) => {
                  setActiveStatus(next)
                  onStatusChange?.(next)
                }}
              />
            ))}
          </div>
        </div>
      ) : null}

      {pinnedTopActions && pinnedTopActions.length > 0 ? (
        <div
          className="flex flex-col gap-0.5 border-b border-border p-2"
          data-slot="time-picker-pinned-top"
        >
          {pinnedTopActions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              disabled={disabled}
              className="flex h-9 w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-brand-violet transition-colors hover:bg-brand-violet/10 cursor-pointer disabled:pointer-events-none disabled:opacity-60"
              data-slot="time-picker-pinned-action"
            >
              {action.icon ? (
                <span className="flex shrink-0 items-center [&_svg]:size-4" aria-hidden="true">
                  {action.icon}
                </span>
              ) : null}
              <span className="flex-1 text-left">{action.label}</span>
              {action.rightText ? (
                <span className="text-brand-violet/60">{action.rightText}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      <div
        className="flex flex-col gap-0.5 overflow-y-auto p-2"
        style={{ maxHeight }}
        ref={slotListRef}
        onKeyDown={handleSlotKeyDown}
        data-slot="time-picker-slots"
      >
        {slotLabel ? (
          <p className="px-3 pt-1 pb-2 text-sm font-medium text-muted-foreground">{slotLabel}</p>
        ) : null}
        {slotList.length === 0 ? (
          <p className="px-3 py-4 text-center text-sm text-muted-foreground">No time slots available.</p>
        ) : (
          slotList.map((slot) => (
            <TimePickerSlot
              key={slot}
              value={slot}
              format={format}
              rightText={slotRightText?.(slot)}
              selected={value === slot}
              disabled={disabled}
              onSelect={(next) => setValue(next)}
            />
          ))
        )}
      </div>

      {showFooter ? (
        <div
          className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3"
          data-slot="time-picker-footer"
        >
          {legacyFooterActions && legacyFooterActions.length > 0 ? (
            <div className="mr-auto flex items-center gap-1">
              {legacyFooterActions.map((action) => (
                <Button
                  key={action.label}
                  type="button"
                  variant={action.variant === 'muted' ? 'muted' : 'ghost'}
                  size="sm"
                  onClick={action.onClick}
                  disabled={disabled}
                  data-slot="time-picker-legacy-action"
                >
                  {action.label}
                </Button>
              ))}
              <span aria-hidden="true" className="ml-2 mr-1 h-5 w-px bg-border" />
            </div>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCancel}
            disabled={disabled}
            data-slot="time-picker-cancel"
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={handleApply}
            disabled={disabled}
            data-slot="time-picker-apply"
          >
            {applyLabel}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export function TimePicker({
  value: valueProp,
  defaultValue = null,
  onChange,
  showHeader = true,
  headerIcon,
  headerTitle,
  headerPlaceholder,
  onClose,
  durations,
  activeDuration: activeDurationProp,
  defaultActiveDuration,
  onDurationChange,
  statuses,
  activeStatus: activeStatusProp,
  defaultActiveStatus,
  onStatusChange,
  statusLabel,
  slots: slotsProp,
  startTime = '00:00',
  endTime = '23:30',
  intervalMinutes = 30,
  format = '12h',
  slotRightText,
  slotLabel,
  maxHeight = 280,
  showFooter = true,
  cancelLabel,
  applyLabel,
  onCancel,
  onApply,
  legacyFooterActions,
  pinnedTopActions,
  trigger,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  popoverAlign = 'start',
  popoverSide = 'bottom',
  className,
  disabled = false,
  'aria-label': ariaLabel,
}: TimePickerProps) {
  const t = useT()
  const resolvedHeaderPlaceholder = headerPlaceholder ?? t('ui.timePicker.placeholder', 'Pick a time')
  const resolvedStatusLabel = statusLabel ?? t('ui.timePicker.statusLabel', 'Select status')
  const resolvedCancelLabel = cancelLabel ?? t('ui.timePicker.cancelButton', 'Cancel')
  const resolvedApplyLabel = applyLabel ?? t('ui.timePicker.applyButton', 'Apply')
  const resolvedAriaLabel = ariaLabel ?? t('ui.timePicker.label', 'Time picker')
  const resolvedCloseAriaLabel = t('ui.timePicker.closeButton', 'Close')
  const resolvedDurationsAriaLabel = t('ui.timePicker.durationsRowLabel', 'Quick duration')
  const resolvedScrollLeftAriaLabel = t('ui.timePicker.scrollLeft', 'Scroll left')
  const resolvedScrollRightAriaLabel = t('ui.timePicker.scrollRight', 'Scroll right')
  const [value, setValue] = useControllable<TimePickerValue>(valueProp, defaultValue, onChange)
  const [activeDuration, setActiveDuration] = useControllable<number | undefined>(
    activeDurationProp,
    defaultActiveDuration,
  )
  const [activeStatus, setActiveStatus] = useControllable<TimePickerStatusVariant | undefined>(
    activeStatusProp,
    defaultActiveStatus,
  )
  const [open, setOpen] = useControllable<boolean>(openProp, defaultOpen, onOpenChange)

  const openSnapshotRef = React.useRef<TimePickerValue>(value)
  const slotListRef = React.useRef<HTMLDivElement | null>(null)

  const slotList = React.useMemo(() => {
    if (slotsProp && slotsProp.length > 0) return slotsProp
    return generateSlots(startTime, endTime, intervalMinutes)
  }, [slotsProp, startTime, endTime, intervalMinutes])

  const setOpenWithSnapshot = React.useCallback(
    (next: boolean) => {
      if (next && !open) {
        openSnapshotRef.current = value
      }
      setOpen(next)
    },
    [open, setOpen, value],
  )

  const handleApply = React.useCallback(() => {
    onApply?.(value)
    if (trigger) setOpenWithSnapshot(false)
  }, [onApply, setOpenWithSnapshot, trigger, value])

  const handleCancel = React.useCallback(() => {
    onCancel?.()
    if (trigger) {
      setValue(openSnapshotRef.current)
      setOpenWithSnapshot(false)
    }
  }, [onCancel, setOpenWithSnapshot, setValue, trigger])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        handleCancel()
      } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        handleApply()
      }
    },
    [handleApply, handleCancel],
  )

  const card = (
    <div onKeyDown={handleKeyDown}>
      <TimePickerCard
        value={value}
        setValue={setValue}
        showHeader={showHeader}
        headerIcon={headerIcon}
        headerTitle={headerTitle}
        headerPlaceholder={resolvedHeaderPlaceholder}
        onClose={onClose}
        closeAriaLabel={resolvedCloseAriaLabel}
        format={format}
        durationOptions={durations}
        activeDuration={activeDuration}
        setActiveDuration={setActiveDuration}
        onDurationChange={onDurationChange}
        durationsAriaLabel={resolvedDurationsAriaLabel}
        scrollLeftAriaLabel={resolvedScrollLeftAriaLabel}
        scrollRightAriaLabel={resolvedScrollRightAriaLabel}
        statusOptions={statuses}
        activeStatus={activeStatus}
        setActiveStatus={setActiveStatus}
        onStatusChange={onStatusChange}
        statusLabel={resolvedStatusLabel}
        slotList={slotList}
        slotLabel={slotLabel}
        slotRightText={slotRightText}
        maxHeight={maxHeight}
        showFooter={showFooter}
        cancelLabel={resolvedCancelLabel}
        applyLabel={resolvedApplyLabel}
        handleCancel={handleCancel}
        handleApply={handleApply}
        legacyFooterActions={legacyFooterActions}
        pinnedTopActions={pinnedTopActions}
        disabled={disabled}
        className={className}
        ariaLabel={resolvedAriaLabel}
        slotListRef={slotListRef}
      />
    </div>
  )

  if (!trigger) return card

  return (
    <Popover open={open} onOpenChange={setOpenWithSnapshot}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={popoverAlign}
        side={popoverSide}
        className="w-auto border-none bg-transparent p-0 shadow-none"
      >
        {card}
      </PopoverContent>
    </Popover>
  )
}
