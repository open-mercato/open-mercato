"use client"

import * as React from 'react'
import { ChevronDown, ChevronRight, Inbox, MoreHorizontal, Plus } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { cn } from '@open-mercato/shared/lib/utils'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownList,
  DropdownTrigger,
} from '@open-mercato/ui/primitives/dropdown'
import { ErrorMessage } from '@open-mercato/ui/backend/detail/ErrorMessage'
import { resolveRegisteredLucideIcon } from '@open-mercato/ui/backend/icons/lucideRegistryRuntime'
import type { BlockAction, BlockTone, BlockToneLabel } from '../contracts/shared'
import type {
  RecordListAddAction,
  RecordListDensity,
  RecordListItem,
  RecordListLayout,
  RecordListProps,
  RecordListSkeletonLeading,
  RecordListVariant,
} from '../contracts/record-list'

const DEFAULT_SKELETON_ROWS = 3
const MAX_VISIBLE_BADGES = 3
const NARROW_CONTAINER_PX = 448
const SKELETON_TITLE_WIDTHS = ['w-40', 'w-56', 'w-32']
const SKELETON_SECONDARY_WIDTHS = ['w-28', 'w-24', 'w-36']

const FRAME_CLASS = 'overflow-hidden rounded-card border border-border bg-card'

const ROW_CLASS: Record<RecordListVariant, Record<RecordListDensity, string>> = {
  card: { default: 'px-4 py-1', compact: 'px-4 py-2' },
  plain: { default: '-mx-2 rounded-md px-2 py-1', compact: '-mx-2 rounded-md px-2 py-2' },
}

const BAND_CLASS: Record<RecordListDensity, string> = { default: 'h-10', compact: 'h-5' }
const WIDE_BAND_CLASS: Record<RecordListDensity, string> = { default: '@md:h-10', compact: '@md:h-5' }

const DOT_CLASS: Record<BlockTone, string> = {
  neutral: 'bg-status-neutral-icon',
  info: 'bg-status-info-icon',
  success: 'bg-status-success-icon',
  warning: 'bg-status-warning-icon',
  error: 'bg-status-error-icon',
}

const REVEAL_CLASS =
  'transition-opacity sm:pointer-fine:opacity-0 sm:pointer-fine:group-hover/row:opacity-100 sm:pointer-fine:group-focus-within/row:opacity-100'

const TARGET_CLASS =
  'outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:shadow-focus'

const TARGET_FOCUS_INSET_CLASS: Record<RecordListVariant, string> = {
  card: 'focus-visible:after:inset-1',
  plain: '',
}

const TITLE_CLASS = 'block min-w-0 max-w-full truncate text-left text-sm leading-5'

const DISABLED_LOOK_CLASS =
  'cursor-not-allowed border-border-disabled bg-bg-disabled text-text-disabled shadow-none hover:bg-bg-disabled hover:text-text-disabled'

const logger = createLogger('ui')
const reportedUnknownIcons = new Set<string>()

function resolveIcon(name: string | undefined) {
  const Icon = resolveRegisteredLucideIcon(name)
  if (Icon || !name || process.env.NODE_ENV === 'production' || reportedUnknownIcons.has(name)) return Icon
  reportedUnknownIcons.add(name)
  logger.warn('[internal] RecordList received an icon name that is not in the icon registry', { icon: name })
  return Icon
}

function isPlainLeftClick(event: React.MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

function isPromise(value: void | Promise<void>): value is Promise<void> {
  return Boolean(value) && typeof (value as Promise<void>).then === 'function'
}

function pendingKeyOf(itemId: string, actionKey: string): string {
  return `${itemId}:${actionKey}`
}

function badgesOf(item: RecordListItem): BlockToneLabel[] {
  if (item.badges) return item.badges
  return item.badge ? [item.badge] : []
}

function isMultiline(item: RecordListItem, density: RecordListDensity): boolean {
  if (item.description) return true
  return density === 'default' && Boolean(item.subtitle || item.meta)
}

function useIsNarrow(ref: React.RefObject<HTMLElement | null>): boolean {
  const [narrow, setNarrow] = React.useState(false)
  React.useEffect(() => {
    const node = ref.current
    if (!node || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width !== undefined) setNarrow(width < NARROW_CONTAINER_PX)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref])
  return narrow
}

function ActionIcon({ name }: { name: string | undefined }) {
  const Icon = resolveIcon(name)
  if (!Icon) return null
  return <Icon aria-hidden="true" className="size-4" />
}

type SplitActions = { inline: BlockAction | undefined; menu: BlockAction[] }

function splitActions(actions: BlockAction[] | undefined, allowInline: boolean): SplitActions {
  if (!actions || actions.length === 0) return { inline: undefined, menu: [] }
  if (!allowInline && actions.length > 1) return { inline: undefined, menu: actions }
  const inline = actions.find((action) => action.tone !== 'destructive' && Boolean(resolveIcon(action.icon)))
  return { inline, menu: actions.filter((action) => action !== inline) }
}

type ListShape = {
  leading: RecordListSkeletonLeading
  inlineSlot: boolean
  menuSlot: boolean
  chevronSlot: boolean
  multipleBadges: boolean
}

function shapeOf(items: RecordListItem[], clickable: boolean, narrow: boolean): ListShape {
  const splits = items.map((item) => splitActions(item.actions, !narrow))
  return {
    leading: items.some((item) => item.avatarLabel) ? 'avatar' : items.some((item) => resolveIcon(item.icon)) ? 'icon' : 'none',
    inlineSlot: splits.some((split) => split.inline !== undefined),
    menuSlot: splits.some((split) => split.menu.length > 0),
    multipleBadges: items.some((item) => badgesOf(item).length > 1),
    chevronSlot: items.some((item) => item.disabled !== true && (clickable || item.href !== undefined)),
  }
}

type ActionRunner = (itemId: string, actionKey: string) => void

type InlineActionProps = {
  item: RecordListItem
  action: BlockAction
  pending: boolean
  interceptLinkClicks: boolean
  onRun: ActionRunner
}

function InlineAction({ item, action, pending, interceptLinkClicks, onRun }: InlineActionProps) {
  const t = useT()
  const label = t('ui.blocks.recordList.actionFor', '{action}: {title}', { action: action.label, title: item.title })
  const hasReason = action.disabled === true && Boolean(action.disabledReason)
  const disabled = action.disabled === true || item.disabled === true
  const glyph = pending ? <Spinner size="sm" /> : <ActionIcon name={action.icon} />
  const tooltip = hasReason ? (
    <span className="flex flex-col gap-1">
      <span>{action.label}</span>
      <span>{action.disabledReason}</span>
    </span>
  ) : (
    action.label
  )
  if (action.href && !disabled && !pending) {
    return (
      <SimpleTooltip content={tooltip}>
        <IconButton asChild variant="ghost" className="size-8 shrink-0 text-muted-foreground" aria-label={label}>
          <a
            href={action.href}
            data-slot="record-list-item-action"
            data-action-key={action.key}
            onClick={(event) => {
              if (!interceptLinkClicks || !isPlainLeftClick(event)) return
              event.preventDefault()
              onRun(item.id, action.key)
            }}
          >
            {glyph}
          </a>
        </IconButton>
      </SimpleTooltip>
    )
  }
  return (
    <SimpleTooltip content={tooltip}>
      <IconButton
        type="button"
        variant="ghost"
        data-slot="record-list-item-action"
        data-action-key={action.key}
        className={cn('size-8 shrink-0 text-muted-foreground', hasReason && DISABLED_LOOK_CLASS)}
        aria-label={label}
        aria-busy={pending || undefined}
        aria-disabled={hasReason ? 'true' : undefined}
        disabled={(disabled && !hasReason) || pending}
        onClick={() => {
          if (disabled) return
          onRun(item.id, action.key)
        }}
      >
        {glyph}
      </IconButton>
    </SimpleTooltip>
  )
}

type MenuLinkItemProps = {
  itemId: string
  action: BlockAction
  interceptLinkClicks: boolean
  onClose: () => void
  onRun: ActionRunner
}

function MenuLinkItem({ itemId, action, interceptLinkClicks, onClose, onRun }: MenuLinkItemProps) {
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
        data-slot="record-list-menu-link"
        className="outline-none after:absolute after:inset-0"
        onClick={(event) => {
          event.stopPropagation()
          onClose()
          if (!interceptLinkClicks || !isPlainLeftClick(event)) return
          event.preventDefault()
          onRun(itemId, action.key)
        }}
      >
        {action.label}
      </a>
    </DropdownItem>
  )
}

type ActionsMenuProps = {
  item: RecordListItem
  actions: BlockAction[]
  pendingKeys: ReadonlySet<string>
  interceptLinkClicks: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onRun: ActionRunner
}

function ActionsMenu({ item, actions, pendingKeys, interceptLinkClicks, open, onOpenChange, onRun }: ActionsMenuProps) {
  const t = useT()
  const anyPending = actions.some((action) => pendingKeys.has(pendingKeyOf(item.id, action.key)))
  return (
    <Dropdown open={open} onOpenChange={onOpenChange}>
      <DropdownTrigger asChild>
        <IconButton
          type="button"
          variant="ghost"
          data-slot="record-list-item-menu"
          className="size-8 shrink-0 text-muted-foreground"
          disabled={anyPending || item.disabled === true}
          aria-busy={anyPending || undefined}
          aria-label={t('ui.blocks.recordList.itemActions', 'Actions for {title}', { title: item.title })}
        >
          {anyPending ? <Spinner size="sm" /> : <MoreHorizontal aria-hidden="true" />}
        </IconButton>
      </DropdownTrigger>
      <DropdownContent align="end" className="w-56">
        <DropdownList>
          {actions.map((action) => {
            if (action.href && action.disabled !== true) {
              return (
                <MenuLinkItem
                  key={action.key}
                  itemId={item.id}
                  action={action}
                  interceptLinkClicks={interceptLinkClicks}
                  onClose={() => onOpenChange(false)}
                  onRun={onRun}
                />
              )
            }
            return (
              <DropdownItem
                key={action.key}
                value={action.key}
                size={action.disabledReason ? 56 : 36}
                disabled={action.disabled === true}
                leading={action.icon ? <ActionIcon name={action.icon} /> : undefined}
                description={action.disabledReason}
                className={cn(action.tone === 'destructive' && 'text-destructive')}
                onSelect={() => {
                  onOpenChange(false)
                  onRun(item.id, action.key)
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

type ItemLeadingProps = {
  item: RecordListItem
  density: RecordListDensity
  slot: RecordListSkeletonLeading
  multiline: boolean
}

function ItemLeading({ item, density, slot, multiline }: ItemLeadingProps) {
  if (slot === 'none') return null
  const Icon = item.avatarLabel ? undefined : resolveIcon(item.icon)
  const band = density === 'compact' || (slot === 'icon' && multiline) ? 'h-5' : 'h-10'
  const width = slot === 'avatar' ? (density === 'compact' ? 'w-6' : 'w-8') : 'w-4'
  const filled = Boolean(item.avatarLabel) || Boolean(Icon)
  return (
    <span
      data-slot={filled ? 'record-list-item-leading' : undefined}
      aria-hidden={filled ? undefined : 'true'}
      className={cn('flex shrink-0 items-center justify-center', band, width)}
    >
      {item.avatarLabel ? (
        <Avatar
          label={item.avatarLabel}
          src={item.avatarUrl}
          size={density === 'compact' ? 'sm' : 'md'}
          className={cn('shrink-0 font-normal', density === 'compact' ? 'size-6' : 'size-8')}
        />
      ) : Icon ? (
        <Icon aria-hidden="true" className={cn('size-4', item.disabled ? 'text-text-disabled' : 'text-muted-foreground')} />
      ) : null}
    </span>
  )
}

type ItemTargetProps = {
  item: RecordListItem
  variant: RecordListVariant
  onItemClick: ((itemId: string) => void) | undefined
  stretchedOnly: boolean
}

function ItemTarget({ item, variant, onItemClick, stretchedOnly }: ItemTargetProps) {
  const interactive = item.disabled !== true && (item.href !== undefined || onItemClick !== undefined)
  if (!interactive) {
    if (stretchedOnly) return null
    return (
      <span data-slot="record-list-item-title" className={cn(TITLE_CLASS, item.disabled ? 'text-text-disabled' : 'text-foreground')}>
        {item.title}
      </span>
    )
  }
  const content = stretchedOnly ? <span className="sr-only">{item.title}</span> : item.title
  const className = cn(
    TARGET_CLASS,
    TARGET_FOCUS_INSET_CLASS[variant],
    'cursor-pointer',
    !stretchedOnly && TITLE_CLASS,
    !stretchedOnly && 'text-foreground',
    stretchedOnly && '-mr-3',
  )
  if (item.href) {
    return (
      <a
        href={item.href}
        data-slot="record-list-item-title"
        className={cn(className, 'underline-offset-4 hover:underline')}
        onClick={(event) => {
          if (!onItemClick || !isPlainLeftClick(event)) return
          event.preventDefault()
          onItemClick(item.id)
        }}
      >
        {content}
      </a>
    )
  }
  return (
    <button type="button" data-slot="record-list-item-title" className={className} onClick={() => onItemClick?.(item.id)}>
      {content}
    </button>
  )
}

type ItemBadgesProps = { badges: BlockToneLabel[]; disabled: boolean; className?: string }

function ItemBadges({ badges, disabled, className }: ItemBadgesProps) {
  const t = useT()
  if (badges.length === 0) return null
  const visible = badges.slice(0, MAX_VISIBLE_BADGES)
  const hidden = badges.slice(MAX_VISIBLE_BADGES)
  const hiddenLabels = hidden.map((badge) => badge.label).join(', ')
  return (
    <div data-slot="record-list-item-badges" className={cn('flex min-w-0 items-center gap-x-3 gap-y-1', className)}>
      {visible.map((badge, index) => {
        const dot = (
          <span
            key={`${badge.label}:${index}`}
            data-slot="record-list-item-badge"
            data-tone={badge.tone}
            className={cn('flex min-w-0 items-center gap-2 text-sm leading-5', disabled ? 'text-text-disabled' : 'text-muted-foreground')}
          >
            <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', disabled ? 'bg-text-disabled' : DOT_CLASS[badge.tone])} />
            <span className="min-w-0 truncate">{badge.label}</span>
          </span>
        )
        if (hidden.length === 0 || index < visible.length - 1) return dot
        return (
          <span key="last" className="flex min-w-0 items-center gap-3">
            {dot}
            <span data-slot="record-list-item-badges-more" title={hiddenLabels} className="shrink-0 text-sm leading-5 tabular-nums text-muted-foreground">
              <span aria-hidden="true">+{hidden.length}</span>
              <span className="sr-only">
                {t('ui.blocks.recordList.moreBadges', '{count} more: {labels}', { count: hidden.length, labels: hiddenLabels })}
              </span>
            </span>
          </span>
        )
      })}
    </div>
  )
}

type ItemTextProps = {
  item: RecordListItem
  density: RecordListDensity
  target: React.ReactNode
  showDescription: boolean
  unwrapWhenNarrow: boolean
}

function ItemText({ item, density, target, showDescription, unwrapWhenNarrow }: ItemTextProps) {
  const hasSecondary = Boolean(item.subtitle || item.meta)
  const secondary = hasSecondary ? (
    <p
      data-slot="record-list-item-secondary"
      className={cn(
        'min-w-0 truncate text-sm leading-5',
        item.disabled ? 'text-text-disabled' : 'text-muted-foreground',
        density === 'compact' && 'flex-1 basis-0',
        unwrapWhenNarrow && 'order-3 w-full',
      )}
    >
      {item.subtitle ? <span data-slot="record-list-item-subtitle">{item.subtitle}</span> : null}
      {item.subtitle && item.meta ? ', ' : null}
      {item.meta ? <span data-slot="record-list-item-meta">{item.meta}</span> : null}
    </p>
  ) : null
  const description =
    showDescription && item.description ? (
      <p
        data-slot="record-list-item-description"
        className={cn(
          'line-clamp-2 text-sm leading-5',
          item.disabled ? 'text-text-disabled' : 'text-muted-foreground',
          unwrapWhenNarrow && 'order-4 w-full',
        )}
      >
        {item.description}
      </p>
    ) : null
  return (
    <div
      data-slot="record-list-item-text"
      className={cn(
        'min-w-0 flex-1 basis-0 flex-col justify-center',
        unwrapWhenNarrow ? 'contents @md:flex' : 'flex',
        density === 'default' && 'min-h-10',
      )}
    >
      {density === 'compact' ? (
        <div className="flex min-w-0 items-baseline gap-2">
          <div className="min-w-0 shrink">{target}</div>
          {secondary}
        </div>
      ) : (
        <>
          <div className={cn('flex min-w-0', unwrapWhenNarrow && 'order-1 flex-1 basis-0')}>{target}</div>
          {secondary}
        </>
      )}
      {description}
    </div>
  )
}

type ItemRowProps = {
  item: RecordListItem
  layout: RecordListLayout
  density: RecordListDensity
  variant: RecordListVariant
  shape: ListShape
  narrow: boolean
  pendingKeys: ReadonlySet<string>
  interceptActionLinks: boolean
  onItemClick: ((itemId: string) => void) | undefined
  renderItem: ((item: RecordListItem) => React.ReactNode) | undefined
  onRun: ActionRunner
}

function ItemRow(props: ItemRowProps) {
  const { item, layout, density, variant, shape, narrow, pendingKeys, interceptActionLinks, onItemClick, renderItem, onRun } = props
  const [menuOpen, setMenuOpen] = React.useState(false)
  const { inline, menu } = splitActions(item.actions, !narrow)
  const interactive = item.disabled !== true && (item.href !== undefined || onItemClick !== undefined)
  const custom = renderItem !== undefined
  const tiles = layout === 'cards'
  const multiline = isMultiline(item, density)
  const band = BAND_CLASS[density]
  const badges = badgesOf(item)
  const hasPending = (item.actions ?? []).some((action) => pendingKeys.has(pendingKeyOf(item.id, action.key)))
  const target = <ItemTarget item={item} variant={tiles ? 'plain' : variant} onItemClick={onItemClick} stretchedOnly={custom} />

  const trailing = item.trailing ? (
    <span
      data-slot="record-list-item-trailing"
      className={cn(
        'flex shrink-0 items-center justify-end whitespace-nowrap text-sm leading-5 tabular-nums',
        !tiles && 'order-2 @md:order-none @md:min-w-28',
        item.disabled ? 'text-text-disabled' : 'text-foreground',
        !tiles && (multiline ? 'h-5' : band),
        !tiles && WIDE_BAND_CLASS[density],
      )}
    >
      {item.trailing}
    </span>
  ) : null

  const hasActions = inline !== undefined || menu.length > 0
  const reserveActions = !tiles && (shape.inlineSlot || shape.menuSlot)
  const actions =
    hasActions || reserveActions ? (
      <div
        data-slot={hasActions ? 'record-list-item-actions' : undefined}
        className={cn(
          'relative flex shrink-0 items-center',
          band,
          !(menuOpen || hasPending) && REVEAL_CLASS,
        )}
      >
        {inline ? (
          <InlineAction
            item={item}
            action={inline}
            pending={pendingKeys.has(pendingKeyOf(item.id, inline.key))}
            interceptLinkClicks={interceptActionLinks}
            onRun={onRun}
          />
        ) : reserveActions && shape.inlineSlot ? (
          <span aria-hidden="true" className="size-8 shrink-0" />
        ) : null}
        {menu.length > 0 ? (
          <ActionsMenu
            item={item}
            actions={menu}
            pendingKeys={pendingKeys}
            interceptLinkClicks={interceptActionLinks}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            onRun={onRun}
          />
        ) : reserveActions && shape.menuSlot ? (
          <span aria-hidden="true" className="size-8 shrink-0" />
        ) : null}
      </div>
    ) : null

  const chevron = shape.chevronSlot ? (
    <span
      aria-hidden="true"
      data-slot={interactive ? 'record-list-item-chevron' : undefined}
      className={cn('pointer-events-none flex w-4 shrink-0 items-center text-muted-foreground', band, REVEAL_CLASS)}
    >
      {interactive ? <ChevronRight className="size-4" /> : null}
    </span>
  ) : null

  const end =
    actions || chevron ? (
      <div data-slot="record-list-item-end" className="-mr-2 flex shrink-0 items-start gap-1">
        {actions}
        {chevron}
      </div>
    ) : null

  const itemProps = {
    'data-slot': 'record-list-item',
    'data-item-id': item.id,
    'data-interactive': interactive ? 'true' : undefined,
    'aria-disabled': item.disabled ? ('true' as const) : undefined,
  }

  const customBody = custom ? (
    <>
      {target}
      <div
        data-slot="record-list-item-body"
        className={cn(
          'relative min-w-0 flex-1',
          interactive && 'pointer-events-none [&_a]:pointer-events-auto [&_button]:pointer-events-auto',
        )}
      >
        {renderItem(item)}
      </div>
    </>
  ) : null

  if (tiles) {
    return (
      <li
        {...itemProps}
        className={cn(
          'group/row relative flex min-w-0 flex-col gap-2 rounded-md bg-muted/50 p-3',
          interactive && 'transition-colors hover:bg-muted',
        )}
      >
        <div className="flex min-w-0 items-start gap-3">
          {custom ? (
            customBody
          ) : (
            <>
              <ItemLeading item={item} density={density} slot={shape.leading} multiline={multiline} />
              <ItemText item={item} density={density} target={target} showDescription={false} unwrapWhenNarrow={false} />
            </>
          )}
          {end}
        </div>
        {!custom && item.description ? (
          <p
            data-slot="record-list-item-description"
            className={cn('line-clamp-2 text-sm leading-5', item.disabled ? 'text-text-disabled' : 'text-muted-foreground')}
          >
            {item.description}
          </p>
        ) : null}
        {!custom && (badges.length > 0 || trailing) ? (
          <div data-slot="record-list-item-tail" className="mt-auto flex min-w-0 items-end justify-between gap-3">
            <ItemBadges badges={badges} disabled={item.disabled === true} className="flex-wrap" />
            <span className="ml-auto flex shrink-0">{trailing}</span>
          </div>
        ) : null}
      </li>
    )
  }

  return (
    <li
      {...itemProps}
      className={cn(
        'group/row relative flex min-w-0 items-start gap-3',
        ROW_CLASS[variant][density],
        density === 'default' && item.description && 'py-2',
        interactive && 'transition-colors hover:bg-muted',
      )}
    >
      {custom ? (
        customBody
      ) : (
        <>
          <ItemLeading item={item} density={density} slot={shape.leading} multiline={multiline} />
          <div data-slot="record-list-item-body" className="flex min-w-0 flex-1 flex-wrap items-start gap-x-4 @md:flex-nowrap">
            <ItemText item={item} density={density} target={target} showDescription unwrapWhenNarrow={density === 'default' && multiline} />
            <ItemBadges
              badges={badges}
              disabled={item.disabled === true}
              className={cn(
                'order-last mt-1 w-full flex-wrap @md:order-none @md:mt-0 @md:w-auto @md:min-w-32 @md:max-w-1/2 @md:shrink @md:flex-nowrap',
                shape.multipleBadges && '@md:justify-end',
                WIDE_BAND_CLASS[density],
              )}
            />
            {trailing}
          </div>
        </>
      )}
      {end}
    </li>
  )
}

type AddButtonProps = {
  action: RecordListAddAction
  onAdd: (() => void) | undefined
  placement: 'header' | 'empty'
  narrow: boolean
}

function AddButton({ action, onAdd, placement, narrow }: AddButtonProps) {
  const reasonId = React.useId()
  const Icon = resolveIcon(action.icon) ?? Plus
  const inHeader = placement === 'header'
  const hasReason = action.disabled === true && Boolean(action.disabledReason)
  const iconOnly = inHeader && narrow
  const tooltip = hasReason ? (
    <span className="flex flex-col gap-1">
      {iconOnly ? <span>{action.label}</span> : null}
      <span>{action.disabledReason}</span>
    </span>
  ) : iconOnly ? (
    action.label
  ) : undefined
  const variant = inHeader ? 'ghost' : 'outline'
  const className = cn('h-10 max-w-full shrink-0 sm:h-8', inHeader && '-mr-2 text-foreground')
  const content = (
    <>
      <Icon aria-hidden="true" className="size-4" />
      <span data-slot="record-list-add-label" className={cn('min-w-0 truncate', inHeader && 'sr-only @md:not-sr-only @md:truncate')}>
        {action.label}
      </span>
    </>
  )
  if (action.href && action.disabled !== true) {
    return (
      <SimpleTooltip content={tooltip}>
        <Button asChild size="sm" variant={variant} data-slot="record-list-add" className={className}>
          <a
            href={action.href}
            onClick={(event) => {
              if (!onAdd || !isPlainLeftClick(event)) return
              event.preventDefault()
              onAdd()
            }}
          >
            {content}
          </a>
        </Button>
      </SimpleTooltip>
    )
  }
  return (
    <>
      <SimpleTooltip content={tooltip}>
        <Button
          type="button"
          size="sm"
          variant={variant}
          data-slot="record-list-add"
          className={cn(className, hasReason && DISABLED_LOOK_CLASS)}
          disabled={action.disabled === true && !hasReason}
          aria-disabled={hasReason ? 'true' : undefined}
          aria-describedby={hasReason ? reasonId : undefined}
          onClick={() => {
            if (action.disabled) return
            onAdd?.()
          }}
        >
          {content}
        </Button>
      </SimpleTooltip>
      {hasReason ? (
        <span id={reasonId} className="sr-only">
          {action.disabledReason}
        </span>
      ) : null}
    </>
  )
}

type SkeletonProps = {
  layout: RecordListLayout
  density: RecordListDensity
  variant: RecordListVariant
  rows: number
  leading: RecordListSkeletonLeading
}

function SkeletonLeading({ leading, density }: { leading: RecordListSkeletonLeading; density: RecordListDensity }) {
  if (leading === 'none') return null
  if (leading === 'icon') return <Skeleton className="size-4 shrink-0" />
  return <Skeleton shape="circle" className={cn('shrink-0', density === 'compact' ? 'size-6' : 'size-8')} />
}

function RecordListSkeleton({ layout, density, variant, rows, leading }: SkeletonProps) {
  const indexes = Array.from({ length: rows }, (_, index) => index)
  const lines = (index: number) => (
    <div className={cn('flex min-w-0 flex-1', density === 'compact' ? 'h-5 items-center gap-3' : 'h-10 flex-col justify-center gap-2')}>
      <Skeleton className={cn('h-3 max-w-full', SKELETON_TITLE_WIDTHS[index % SKELETON_TITLE_WIDTHS.length])} />
      <Skeleton className={cn('h-3 max-w-full', SKELETON_SECONDARY_WIDTHS[index % SKELETON_SECONDARY_WIDTHS.length])} />
    </div>
  )
  if (layout === 'cards') {
    return (
      <div
        aria-hidden="true"
        data-slot="record-list-skeleton"
        className={cn('grid grid-cols-1 gap-2 @lg:grid-cols-2 @3xl:grid-cols-3', variant === 'card' && 'p-4')}
      >
        {indexes.map((index) => (
          <div key={index} className="flex items-center gap-3 rounded-md bg-muted/50 p-3">
            <SkeletonLeading leading={leading} density={density} />
            {lines(index)}
          </div>
        ))}
      </div>
    )
  }
  return (
    <div aria-hidden="true" data-slot="record-list-skeleton" className={cn(variant === 'card' && 'divide-y divide-border')}>
      {indexes.map((index) => (
        <div key={index} data-slot="record-list-skeleton-row" className={cn('flex items-center gap-3', variant === 'card' ? 'px-4 py-2' : 'py-2')}>
          <SkeletonLeading leading={leading} density={density} />
          {lines(index)}
          <Skeleton className="h-3 w-16 shrink-0" />
        </div>
      ))}
    </div>
  )
}

export function RecordList(props: RecordListProps) {
  const t = useT()
  const {
    items,
    title,
    ariaLabel,
    count,
    headingLevel = 3,
    addAction,
    onAdd,
    onItemClick,
    onItemAction,
    renderItem,
    layout = 'rows',
    density = 'default',
    variant = 'card',
    maxItems,
    onShowAll,
    showAllLabel,
    emptyTitle,
    emptyDescription,
    emptyIcon,
    skeleton,
    status,
    errorMessage,
    onRetry,
    emptyState,
    className,
  } = props
  const headingId = React.useId()
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const narrow = useIsNarrow(rootRef)
  const [expanded, setExpanded] = React.useState(false)
  const [pendingKeys, setPendingKeys] = React.useState<ReadonlySet<string>>(() => new Set())

  const runAction = React.useCallback<ActionRunner>(
    (itemId, actionKey) => {
      const result = onItemAction?.(itemId, actionKey)
      if (!isPromise(result)) return
      const pendingKey = pendingKeyOf(itemId, actionKey)
      setPendingKeys((current) => new Set(current).add(pendingKey))
      const clear = () =>
        setPendingKeys((current) => {
          const next = new Set(current)
          next.delete(pendingKey)
          return next
        })
      result.then(clear, clear)
    },
    [onItemAction],
  )

  const isLoading = status === 'loading'
  const isError = status === 'error'
  const isEmpty = !isLoading && !isError && (status === 'empty' || items.length === 0)
  const isReady = !isLoading && !isError && !isEmpty
  const framed = variant === 'card' && !isError
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4'

  const capped = maxItems !== undefined && !expanded
  const visibleItems = capped ? items.slice(0, maxItems) : items
  const total = count ?? items.length
  const hasMore = capped && total > visibleItems.length
  const showHeaderAdd = addAction !== undefined && !isEmpty && !isError
  const hasHeader = title !== undefined || showHeaderAdd
  const shape = shapeOf(visibleItems, onItemClick !== undefined, narrow)
  const EmptyIcon = resolveIcon(emptyIcon) ?? Inbox
  const ShowAllIcon = onShowAll ? ChevronRight : ChevronDown

  const header = hasHeader ? (
    <div
      data-slot="record-list-header"
      className={cn(
        'flex min-h-12 min-w-0 items-center justify-between gap-3',
        framed ? 'px-4 py-2' : 'pb-1',
        framed && !isEmpty && 'border-b border-border',
      )}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        {title ? (
          <Heading id={headingId} data-slot="record-list-title" className="min-w-0 truncate text-base leading-6 text-foreground">
            {title}
          </Heading>
        ) : null}
        {title && count !== undefined && isReady && !hasMore ? (
          <span data-slot="record-list-count" className="shrink-0 text-sm tabular-nums text-muted-foreground">
            <span aria-hidden="true">{count}</span>
            <span className="sr-only">{t('ui.blocks.recordList.count', '{count} in total', { count })}</span>
          </span>
        ) : null}
      </div>
      {showHeaderAdd && addAction ? <AddButton action={addAction} onAdd={onAdd} placement="header" narrow={narrow} /> : null}
    </div>
  ) : null

  const listLabelProps = title ? { 'aria-labelledby': headingId } : { 'aria-label': ariaLabel }

  let body: React.ReactNode
  if (isLoading) {
    body = (
      <>
        <span className="sr-only">{t('ui.blocks.recordList.loading', 'Loading')}</span>
        <RecordListSkeleton
          layout={layout}
          density={density}
          variant={variant}
          rows={skeleton?.rows ?? (items.length > 0 ? Math.min(items.length, maxItems ?? items.length) : DEFAULT_SKELETON_ROWS)}
          leading={skeleton?.leading ?? shapeOf(items, false, narrow).leading}
        />
      </>
    )
  } else if (isError) {
    body = (
      <ErrorMessage
        label={errorMessage ?? t('ui.blocks.recordList.error', 'Could not load the list')}
        className="max-w-xl rounded-md"
        action={
          onRetry ? (
            <Button type="button" size="sm" variant="outline" className="text-foreground" onClick={onRetry}>
              {t('ui.blocks.recordList.retry', 'Try again')}
            </Button>
          ) : undefined
        }
      />
    )
  } else if (isEmpty) {
    body = (
      <div data-slot="record-list-empty">
        {emptyState ?? (
          <EmptyState
            size="sm"
            icon={<EmptyIcon aria-hidden="true" className="size-5" />}
            title={emptyTitle ?? t('ui.blocks.recordList.empty', 'Nothing here yet')}
            description={emptyDescription ?? t('ui.blocks.recordList.emptyDescription', 'Records will show up here once they are added.')}
            className={cn('[&_p]:font-normal', variant === 'plain' && 'items-start px-0 text-left')}
            actions={addAction ? <AddButton action={addAction} onAdd={onAdd} placement="empty" narrow={false} /> : undefined}
          />
        )}
      </div>
    )
  } else {
    body = (
      <>
        <ul
          {...listLabelProps}
          data-slot="record-list-items"
          className={cn(
            layout === 'cards'
              ? cn('grid grid-cols-1 gap-2 @lg:grid-cols-2 @3xl:grid-cols-3', variant === 'card' && 'p-4')
              : variant === 'card' && 'divide-y divide-border',
          )}
        >
          {visibleItems.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              layout={layout}
              density={density}
              variant={variant}
              shape={shape}
              narrow={narrow}
              pendingKeys={pendingKeys}
              interceptActionLinks={onItemAction !== undefined}
              onItemClick={onItemClick}
              renderItem={renderItem}
              onRun={runAction}
            />
          ))}
        </ul>
        {hasMore ? (
          <div data-slot="record-list-footer" className={cn(variant === 'card' ? 'border-t border-border' : '-mx-2')}>
            <button
              type="button"
              data-slot="record-list-show-all"
              className={cn(
                'relative flex h-10 w-full cursor-pointer items-center justify-between gap-3 text-left text-sm text-muted-foreground outline-none transition-colors',
                'after:absolute after:rounded-md hover:bg-muted hover:text-foreground focus-visible:text-foreground focus-visible:after:shadow-focus',
                variant === 'card' ? 'px-4 after:inset-1' : 'rounded-md px-2 after:inset-0',
              )}
              onClick={() => {
                if (onShowAll) {
                  onShowAll()
                  return
                }
                setExpanded(true)
              }}
            >
              <span className="min-w-0 truncate">
                {showAllLabel ?? t('ui.blocks.recordList.showAll', 'Show all {count}', { count: total })}
              </span>
              <ShowAllIcon aria-hidden="true" className="size-4 shrink-0" />
            </button>
          </div>
        ) : null}
      </>
    )
  }

  return (
    <div
      ref={rootRef}
      data-slot="record-list"
      data-variant={variant}
      data-layout={layout}
      data-density={density}
      data-status={isLoading ? 'loading' : isError ? 'error' : isEmpty ? 'empty' : 'ready'}
      aria-busy={isLoading || undefined}
      className={cn('@container min-w-0', framed && FRAME_CLASS, className)}
    >
      {header}
      {body}
    </div>
  )
}
