"use client"

import * as React from 'react'
import { MoreHorizontal, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Progress } from '@open-mercato/ui/primitives/progress'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownList,
  DropdownTrigger,
} from '@open-mercato/ui/primitives/dropdown'
import { resolveRegisteredLucideIcon } from '@open-mercato/ui/backend/icons/lucideRegistryRuntime'
import type { BlockAction } from '../contracts/shared'
import type {
  BulkActionBarDestructivePlacement,
  BulkActionBarProgress,
  BulkActionBarProps,
} from '../contracts/bulk-action-bar'

const DEFAULT_MAX_VISIBLE_ACTIONS = 3
const PHONE_MAX_VISIBLE_ACTIONS = 1
const WIDE_VIEWPORT_QUERY = '(min-width: 40rem)'
const OPEN_LAYER_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"]'
const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]'

function subscribeToViewport(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined
  const query = window.matchMedia(WIDE_VIEWPORT_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function readIsPhoneViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return !window.matchMedia(WIDE_VIEWPORT_QUERY).matches
}

function readIsPhoneViewportOnServer(): boolean {
  return false
}

function useIsPhoneViewport(): boolean {
  return React.useSyncExternalStore(subscribeToViewport, readIsPhoneViewport, readIsPhoneViewportOnServer)
}

const DISABLED_LOOK_CLASS =
  'cursor-not-allowed border-border-disabled bg-bg-disabled text-text-disabled shadow-none hover:bg-bg-disabled hover:text-text-disabled'

const logger = createLogger('ui')
const reportedUnknownIcons = new Set<string>()

function resolveIcon(name: string | undefined) {
  const Icon = resolveRegisteredLucideIcon(name)
  if (Icon || !name || process.env.NODE_ENV === 'production' || reportedUnknownIcons.has(name)) return Icon
  reportedUnknownIcons.add(name)
  logger.warn('[internal] BulkActionBar received an icon name that is not in the icon registry', { icon: name })
  return Icon
}

function isPlainLeftClick(event: React.MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

function rendersAsLink(action: BlockAction): boolean {
  return Boolean(action.href) && action.disabled !== true
}

function ActionIcon({ name }: { name: string | undefined }) {
  const Icon = resolveIcon(name)
  if (!Icon) return null
  return <Icon aria-hidden="true" className="size-4" />
}

type ActionSplit = {
  visible: BlockAction[]
  overflow: BlockAction[]
}

function splitActions(
  actions: BlockAction[],
  maxVisible: number,
  destructivePlacement: BulkActionBarDestructivePlacement,
): ActionSplit {
  const visible: BlockAction[] = []
  const overflow: BlockAction[] = []
  for (const action of actions) {
    const mayBeVisible = destructivePlacement === 'inline' || action.tone !== 'destructive'
    if (mayBeVisible && visible.length < maxVisible) visible.push(action)
    else overflow.push(action)
  }
  return { visible, overflow }
}

function hasDisabledReason(action: BlockAction): boolean {
  return action.disabled === true && Boolean(action.disabledReason)
}

function isEditableElement(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false
  return element.isContentEditable || element.matches(EDITABLE_SELECTOR)
}

type ActionButtonProps = {
  action: BlockAction
  pending: boolean
  blocked: boolean
  reasonId: string
  onRun: (key: string) => void
}

function ActionButton({ action, pending, blocked, reasonId, onRun }: ActionButtonProps) {
  const hasReason = hasDisabledReason(action)
  const busy = pending || blocked
  const ariaDisabled = hasReason && !busy
  const asLink = rendersAsLink(action)
  const variant = action.tone === 'destructive' ? 'destructive-ghost' : 'outline'
  const className = cn('h-10 min-w-0 shrink sm:h-8', (ariaDisabled || (asLink && busy)) && DISABLED_LOOK_CLASS)
  const content = (
    <>
      {pending ? <Spinner size="sm" /> : <ActionIcon name={action.icon} />}
      <span className="min-w-0 truncate">{action.label}</span>
    </>
  )
  const button = asLink ? (
    <Button
      asChild
      size="sm"
      variant={variant}
      aria-disabled={busy ? 'true' : undefined}
      aria-busy={pending || undefined}
      className={className}
    >
      <a
        href={action.href}
        data-slot="bulk-action-bar-action"
        onClick={(event) => {
          if (busy) {
            event.preventDefault()
            return
          }
          if (event.defaultPrevented || !isPlainLeftClick(event)) return
          event.preventDefault()
          onRun(action.key)
        }}
      >
        {content}
      </a>
    </Button>
  ) : (
    <Button
      type="button"
      size="sm"
      variant={variant}
      data-slot="bulk-action-bar-action"
      disabled={(action.disabled === true && !hasReason) || busy}
      aria-disabled={ariaDisabled ? 'true' : undefined}
      aria-busy={pending || undefined}
      aria-describedby={hasReason ? reasonId : undefined}
      className={className}
      onClick={() => {
        if (ariaDisabled) return
        onRun(action.key)
      }}
    >
      {content}
    </Button>
  )
  if (!hasReason) return button
  return <SimpleTooltip content={action.disabledReason}>{button}</SimpleTooltip>
}

type OverflowLinkItemProps = {
  action: BlockAction
  onClose: () => void
  onRun: (key: string) => void
}

function OverflowLinkItem({ action, onClose, onRun }: OverflowLinkItemProps) {
  const anchorRef = React.useRef<HTMLAnchorElement | null>(null)
  return (
    <DropdownItem
      value={action.key}
      size={36}
      leading={action.icon ? <ActionIcon name={action.icon} /> : undefined}
      className={cn(action.tone === 'destructive' && 'text-destructive')}
      onSelect={() => anchorRef.current?.click()}
    >
      <a
        ref={anchorRef}
        href={action.href}
        tabIndex={-1}
        data-slot="bulk-action-bar-menu-link"
        className="outline-none after:absolute after:inset-0"
        onClick={(event) => {
          event.stopPropagation()
          onClose()
          if (!isPlainLeftClick(event)) return
          event.preventDefault()
          onRun(action.key)
        }}
      >
        {action.label}
      </a>
    </DropdownItem>
  )
}

type OverflowMenuProps = {
  actions: BlockAction[]
  pendingKeys: ReadonlySet<string>
  blocked: boolean
  onRun: (key: string) => void
}

function OverflowMenu({ actions, pendingKeys, blocked, onRun }: OverflowMenuProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const ownPending = actions.some((action) => pendingKeys.has(action.key))
  return (
    <Dropdown open={open} onOpenChange={setOpen}>
      <DropdownTrigger asChild>
        <IconButton
          type="button"
          variant="outline"
          className="size-10 shrink-0 sm:size-8"
          disabled={blocked}
          aria-busy={ownPending || undefined}
          aria-label={t('ui.blocks.bulkActionBar.moreActions', 'More actions')}
        >
          {ownPending ? <Spinner size="sm" /> : <MoreHorizontal aria-hidden="true" />}
        </IconButton>
      </DropdownTrigger>
      <DropdownContent align="end" className="w-56">
        <DropdownList>
          {actions.map((action) => {
            const icon = action.icon ? <ActionIcon name={action.icon} /> : undefined
            if (rendersAsLink(action)) {
              return <OverflowLinkItem key={action.key} action={action} onClose={() => setOpen(false)} onRun={onRun} />
            }
            return (
              <DropdownItem
                key={action.key}
                value={action.key}
                size={action.disabledReason ? 56 : 36}
                disabled={action.disabled === true}
                leading={icon}
                description={action.disabledReason}
                className={cn(action.tone === 'destructive' && 'text-destructive')}
                onSelect={() => {
                  setOpen(false)
                  onRun(action.key)
                }}
              >
                {action.label}
              </DropdownItem>
            )
          })}
        </DropdownList>
      </DropdownContent>
    </Dropdown>
  )
}

function ProgressStatus({ progress }: { progress: BulkActionBarProgress }) {
  const t = useT()
  const { label, done, total } = progress
  const determinate = done !== undefined && total !== undefined
  const countLabel = determinate
    ? t('ui.blocks.bulkActionBar.progressCount', '{done} of {total}', { done, total })
    : null
  return (
    <div
      data-slot="bulk-action-bar-progress"
      className="flex min-w-0 basis-full items-center gap-3 sm:basis-auto sm:flex-1 sm:justify-end"
    >
      {determinate ? null : <Spinner size="sm" />}
      <span role={determinate ? undefined : 'status'} className="min-w-0 truncate text-sm text-foreground">
        {label}
      </span>
      {countLabel ? (
        <>
          <span aria-hidden="true" className="shrink-0 text-sm tabular-nums text-muted-foreground">
            {countLabel}
          </span>
          <Progress
            value={done ?? 0}
            max={total || 1}
            size="md"
            aria-label={label}
            aria-valuetext={countLabel}
            className="min-w-16 flex-1 sm:w-40 sm:flex-none"
          />
        </>
      ) : null}
    </div>
  )
}

export function BulkActionBar(props: BulkActionBarProps) {
  const t = useT()
  const {
    selectedCount,
    totalCount,
    allMatchingSelected,
    summary,
    actions,
    maxVisibleActions,
    destructivePlacement = 'overflow',
    pendingActionKey,
    progress,
    position = 'floating',
    clearOnEscape = true,
    onAction,
    onClear,
    onSelectAllMatching,
    trailing,
    ariaLabel,
    className,
  } = props
  const reasonIdBase = React.useId()
  const isPhone = useIsPhoneViewport()
  const [ownPendingKeys, setOwnPendingKeys] = React.useState<ReadonlySet<string>>(() => new Set())
  const [announcement, setAnnouncement] = React.useState('')

  const hasSelection = selectedCount > 0
  const shown = hasSelection || progress !== undefined
  const allSelected = allMatchingSelected === true && totalCount !== undefined
  const countLabel = allSelected
    ? t('ui.blocks.bulkActionBar.allSelected', 'All {count} selected', { count: totalCount })
    : t('ui.blocks.bulkActionBar.selected', '{count} selected', { count: selectedCount })

  const pendingKeys = React.useMemo<ReadonlySet<string>>(() => {
    if (!pendingActionKey) return ownPendingKeys
    return new Set(ownPendingKeys).add(pendingActionKey)
  }, [ownPendingKeys, pendingActionKey])
  const anyPending = pendingKeys.size > 0

  const runAction = React.useCallback(
    (key: string) => {
      if (anyPending) return
      const result = onAction(key)
      if (!result || typeof (result as Promise<void>).then !== 'function') return
      setOwnPendingKeys((current) => new Set(current).add(key))
      const clear = () =>
        setOwnPendingKeys((current) => {
          const next = new Set(current)
          next.delete(key)
          return next
        })
      ;(result as Promise<void>).then(clear, clear)
    },
    [anyPending, onAction],
  )

  const visibleLimit = isPhone ? PHONE_MAX_VISIBLE_ACTIONS : (maxVisibleActions ?? DEFAULT_MAX_VISIBLE_ACTIONS)
  const split = React.useMemo(
    () => splitActions(actions, visibleLimit, destructivePlacement),
    [actions, visibleLimit, destructivePlacement],
  )

  React.useEffect(() => {
    setAnnouncement(shown && hasSelection ? countLabel : '')
  }, [shown, hasSelection, countLabel])

  React.useEffect(() => {
    if (!hasSelection || !clearOnEscape) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (isEditableElement(document.activeElement)) return
      if (document.querySelector(OPEN_LAYER_SELECTOR)) return
      event.preventDefault()
      onClear()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [hasSelection, clearOnEscape, onClear])

  if (!shown) return null

  const reasonIdFor = (action: BlockAction) => `${reasonIdBase}-${action.key}`
  const actionsWithReason = split.visible.filter(hasDisabledReason)
  const canSelectAllMatching =
    !allSelected && totalCount !== undefined && totalCount > selectedCount && onSelectAllMatching !== undefined
  const hasButtons = split.visible.length > 0 || split.overflow.length > 0

  return (
    <div
      role="toolbar"
      aria-label={ariaLabel ?? t('ui.blocks.bulkActionBar.label', 'Bulk actions')}
      data-slot="bulk-action-bar"
      data-position={position}
      className={cn(
        'flex flex-col gap-1 rounded-card border border-border bg-card p-2 text-card-foreground',
        'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-200',
        position === 'floating'
          ? 'fixed inset-x-4 bottom-4 z-sticky mx-auto max-w-3xl shadow-lg'
          : 'w-full shadow-sm',
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap sm:gap-3">
        {hasSelection ? (
          <div data-slot="bulk-action-bar-selection" className="flex min-w-0 flex-auto items-center gap-2">
            <IconButton
              type="button"
              variant="ghost"
              className="size-10 shrink-0 sm:size-8"
              aria-label={t('ui.blocks.bulkActionBar.clear', 'Clear selection')}
              onClick={onClear}
            >
              <X aria-hidden="true" />
            </IconButton>
            <div className="flex min-w-0 flex-col gap-x-3 sm:flex-row sm:items-center">
              <span
                aria-hidden="true"
                data-slot="bulk-action-bar-count"
                className="shrink-0 whitespace-nowrap text-sm tabular-nums text-foreground"
              >
                {countLabel}
              </span>
              <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                {announcement}
              </span>
              {summary ? (
                <span data-slot="bulk-action-bar-summary" className="min-w-0 truncate text-sm text-muted-foreground">
                  {summary}
                </span>
              ) : null}
              {canSelectAllMatching ? (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  data-slot="bulk-action-bar-select-all"
                  className="h-10 justify-start px-0 font-normal underline sm:h-8"
                  disabled={anyPending || progress !== undefined}
                  onClick={onSelectAllMatching}
                >
                  {t('ui.blocks.bulkActionBar.selectAll', 'Select all {count}', { count: totalCount })}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {progress ? (
          <ProgressStatus progress={progress} />
        ) : hasButtons ? (
          <div data-slot="bulk-action-bar-actions" className="ml-auto flex min-w-0 items-center gap-2">
            {split.visible.map((action) => (
              <ActionButton
                key={action.key}
                action={action}
                pending={pendingKeys.has(action.key)}
                blocked={anyPending && !pendingKeys.has(action.key)}
                reasonId={reasonIdFor(action)}
                onRun={runAction}
              />
            ))}
            {split.overflow.length > 0 ? (
              <OverflowMenu actions={split.overflow} pendingKeys={pendingKeys} blocked={anyPending} onRun={runAction} />
            ) : null}
          </div>
        ) : null}
        {trailing ? (
          <div data-slot="bulk-action-bar-trailing" className="flex min-w-0 shrink-0 items-center">
            {trailing}
          </div>
        ) : null}
      </div>
      {progress
        ? null
        : actionsWithReason.map((action) => (
            <p
              key={action.key}
              id={reasonIdFor(action)}
              data-slot="bulk-action-bar-action-reason"
              className="px-2 text-right text-xs leading-5 text-muted-foreground md:sr-only"
            >
              {action.disabledReason}
            </p>
          ))}
    </div>
  )
}
