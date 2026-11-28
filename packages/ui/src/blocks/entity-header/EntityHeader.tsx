"use client"

import * as React from 'react'
import { ArrowLeft, MoreHorizontal } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { cn } from '@open-mercato/shared/lib/utils'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
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
import { resolveRegisteredLucideIcon } from '@open-mercato/ui/backend/icons/lucideRegistryRuntime'
import { ErrorMessage } from '@open-mercato/ui/backend/detail/ErrorMessage'
import type { BlockToneLabel } from '../contracts/shared'
import type {
  EntityHeaderAction,
  EntityHeaderDestructivePlacement,
  EntityHeaderMeta,
  EntityHeaderProps,
  EntityHeaderTab,
} from '../contracts/entity-header'

const logger = createLogger('ui')
const reportedUnknownIcons = new Set<string>()

function resolveIcon(name: string | undefined) {
  const Icon = resolveRegisteredLucideIcon(name)
  if (Icon || !name || process.env.NODE_ENV === 'production' || reportedUnknownIcons.has(name)) return Icon
  reportedUnknownIcons.add(name)
  logger.warn('[internal] EntityHeader received an icon name that is not in the icon registry', { icon: name })
  return Icon
}

function ActionIcon({ name }: { name: string | undefined }) {
  const Icon = resolveIcon(name)
  if (!Icon) return null
  return <Icon aria-hidden="true" className="size-4" />
}

const MAX_VISIBLE_SECONDARY_ACTIONS = 2
const DISABLED_LOOK_CLASS =
  'cursor-not-allowed border-border-disabled bg-bg-disabled text-text-disabled shadow-none hover:bg-bg-disabled hover:text-text-disabled'

type ActionSplit = {
  primary: EntityHeaderAction | null
  secondary: EntityHeaderAction[]
  overflow: EntityHeaderAction[]
}

function splitActions(
  actions: EntityHeaderAction[],
  primaryActionKey: string | undefined,
  destructivePlacement: EntityHeaderDestructivePlacement,
): ActionSplit {
  const primary = actions.find((action) => action.key === primaryActionKey && action.tone !== 'destructive') ?? null
  const rest = actions.filter((action) => action !== primary)
  const secondary: EntityHeaderAction[] = []
  const overflow: EntityHeaderAction[] = []
  for (const action of rest) {
    const mayBeVisible = destructivePlacement === 'inline' || action.tone !== 'destructive'
    if (mayBeVisible && secondary.length < MAX_VISIBLE_SECONDARY_ACTIONS) secondary.push(action)
    else overflow.push(action)
  }
  return { primary, secondary, overflow }
}

type ActionButtonProps = {
  action: EntityHeaderAction
  variant: 'default' | 'outline'
  pending: boolean
  reasonId: string
  interceptLinkClicks: boolean
  onRun: (key: string) => void
}

function hasDisabledReason(action: EntityHeaderAction): boolean {
  return action.disabled === true && Boolean(action.disabledReason)
}

function isPlainLeftClick(event: React.MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

function rendersAsLink(action: EntityHeaderAction): boolean {
  return Boolean(action.href) && action.disabled !== true
}

function ActionButton({ action, variant, pending, reasonId, interceptLinkClicks, onRun }: ActionButtonProps) {
  const hasReason = hasDisabledReason(action)
  const ariaDisabled = hasReason && !pending
  const asLink = rendersAsLink(action)
  const iconOnly = action.display === 'icon' && resolveIcon(action.icon) !== null
  const destructive = action.tone === 'destructive'
  const emphasis = variant === 'default' ? 'primary' : 'secondary'
  const handleLinkClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (pending) {
      event.preventDefault()
      return
    }
    if (!interceptLinkClicks || event.defaultPrevented || !isPlainLeftClick(event)) return
    event.preventDefault()
    onRun(action.key)
  }
  const handleButtonClick = () => {
    if (ariaDisabled) return
    onRun(action.key)
  }
  const stateProps = {
    'data-action-emphasis': emphasis,
    'aria-busy': pending || undefined,
    'aria-describedby': hasReason ? reasonId : undefined,
  }
  const linkStateProps = { ...stateProps, 'aria-disabled': pending ? ('true' as const) : undefined }
  const buttonStateProps = {
    ...stateProps,
    type: 'button' as const,
    disabled: (action.disabled === true && !hasReason) || pending,
    'aria-disabled': ariaDisabled ? ('true' as const) : undefined,
    onClick: handleButtonClick,
  }
  const glyph = pending ? <Spinner size="sm" /> : <ActionIcon name={action.icon} />

  if (iconOnly) {
    const iconClassName = cn(
      'size-10 shrink-0 sm:size-8',
      destructive && 'text-destructive hover:text-destructive',
      (ariaDisabled || (asLink && pending)) && DISABLED_LOOK_CLASS,
    )
    const iconVariant = variant === 'default' ? 'primary' : 'outline'
    const iconButton = asLink ? (
      <IconButton asChild variant={iconVariant} className={iconClassName} aria-label={action.label} {...linkStateProps}>
        <a href={action.href} data-display="icon" onClick={handleLinkClick}>
          {glyph}
        </a>
      </IconButton>
    ) : (
      <IconButton
        variant={iconVariant}
        className={iconClassName}
        aria-label={action.label}
        data-display="icon"
        {...buttonStateProps}
      >
        {glyph}
      </IconButton>
    )
    const tooltip = hasReason ? (
      <span className="flex flex-col gap-1">
        <span>{action.label}</span>
        <span>{action.disabledReason}</span>
      </span>
    ) : (
      action.label
    )
    return <SimpleTooltip content={tooltip}>{iconButton}</SimpleTooltip>
  }

  const buttonVariant = destructive ? 'destructive-outline' : variant
  const className = cn(
    'h-10 max-w-full sm:h-8',
    variant === 'default' && 'flex-1 sm:flex-none',
    (ariaDisabled || (asLink && pending)) && DISABLED_LOOK_CLASS,
  )
  const content = (
    <>
      {glyph}
      <span className="min-w-0 truncate">{action.label}</span>
    </>
  )
  const button = asLink ? (
    <Button asChild size="sm" variant={buttonVariant} className={className} {...linkStateProps}>
      <a href={action.href} onClick={handleLinkClick}>
        {content}
      </a>
    </Button>
  ) : (
    <Button size="sm" variant={buttonVariant} className={className} {...buttonStateProps}>
      {content}
    </Button>
  )
  if (!hasReason) return button
  return <SimpleTooltip content={action.disabledReason}>{button}</SimpleTooltip>
}

type OverflowLinkItemProps = {
  action: EntityHeaderAction
  interceptLinkClicks: boolean
  onClose: () => void
  onRun: (key: string) => void
}

function OverflowLinkItem({ action, interceptLinkClicks, onClose, onRun }: OverflowLinkItemProps) {
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
        data-slot="entity-header-menu-link"
        className="outline-none after:absolute after:inset-0"
        onClick={(event) => {
          event.stopPropagation()
          onClose()
          if (!interceptLinkClicks || !isPlainLeftClick(event)) return
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
  actions: EntityHeaderAction[]
  pendingKeys: ReadonlySet<string>
  interceptLinkClicks: boolean
  onRun: (key: string) => void
}

function OverflowMenu({ actions, pendingKeys, interceptLinkClicks, onRun }: OverflowMenuProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const anyPending = actions.some((action) => pendingKeys.has(action.key))
  return (
    <Dropdown open={open} onOpenChange={setOpen}>
      <DropdownTrigger asChild>
        <IconButton
          type="button"
          variant="outline"
          className="size-10 sm:size-8"
          disabled={anyPending}
          aria-busy={anyPending || undefined}
          aria-label={t('ui.blocks.entityHeader.moreActions', 'More actions')}
        >
          {anyPending ? <Spinner size="sm" /> : <MoreHorizontal aria-hidden="true" />}
        </IconButton>
      </DropdownTrigger>
      <DropdownContent align="end" className="w-56">
        <DropdownList>
          {actions.map((action) => {
            const icon = action.icon ? <ActionIcon name={action.icon} /> : undefined
            if (rendersAsLink(action) && !pendingKeys.has(action.key)) {
              return (
                <OverflowLinkItem
                  key={action.key}
                  action={action}
                  interceptLinkClicks={interceptLinkClicks}
                  onClose={() => setOpen(false)}
                  onRun={onRun}
                />
              )
            }
            return (
              <DropdownItem
                key={action.key}
                value={action.key}
                size={action.disabledReason ? 56 : 36}
                disabled={action.disabled === true || pendingKeys.has(action.key)}
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

const MAX_SKELETON_TABS = 6
const TAB_SCROLL_MARGIN = 40

export function entityHeaderTabIds(idBase: string, tabKey: string): { tabId: string; panelId: string } {
  const token = encodeURIComponent(tabKey)
  return { tabId: `${idBase}-tab-${token}`, panelId: `${idBase}-panel-${token}` }
}

function usesPageHeaderProps(props: EntityHeaderProps): boolean {
  return props.tabs !== undefined || props.backLabel !== undefined || props.count !== undefined
}

function LegacySkeletonBody() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <Skeleton shape="circle" className="size-12 shrink-0" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-6 w-48 max-w-full sm:h-7" />
          <Skeleton className="mt-2 h-4 w-40 max-w-full" />
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:flex sm:flex-wrap">
            {[0, 1, 2].map((index) => (
              <div key={index} className="flex flex-col gap-1 sm:flex-row sm:gap-2">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-10 w-16 sm:h-8" />
        <Skeleton className="h-10 flex-1 sm:h-8 sm:w-20 sm:flex-none" />
        <Skeleton className="size-10 sm:size-8" />
      </div>
    </div>
  )
}

function PageSkeletonBody({ props }: { props: EntityHeaderProps }) {
  const { avatar, leading, subtitle, meta, actions, trailing, backLabel, tabs } = props
  const metaCount = meta?.length ?? 0
  const hasActions = Boolean(actions?.length) || Boolean(trailing)
  return (
    <>
      {backLabel ? (
        <div aria-hidden="true" className="-mb-2 flex h-10 items-center sm:h-8">
          <Skeleton className="h-4 w-24" />
        </div>
      ) : null}
      <div aria-hidden="true" className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          {avatar || leading ? <Skeleton shape="circle" className="size-12 shrink-0" /> : null}
          <div className="min-w-0 flex-1">
            <Skeleton className="h-6 w-48 max-w-full sm:h-7" />
            {subtitle ? <Skeleton className="mt-2 h-4 w-64 max-w-full" /> : null}
            {metaCount > 0 ? (
              <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:flex sm:flex-wrap">
                {meta?.map((item) => (
                  <div key={item.key} className="flex flex-col gap-1 sm:flex-row sm:gap-2">
                    <Skeleton className="h-4 w-12" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        {hasActions ? (
          <div className="flex items-center gap-2">
            <Skeleton className="h-10 flex-1 sm:h-8 sm:w-20 sm:flex-none" />
          </div>
        ) : null}
      </div>
      {tabs ? (
        <div
          aria-hidden="true"
          data-slot="entity-header-tabs-skeleton"
          className="flex h-10 items-center gap-6 overflow-hidden border-b border-input"
        >
          {tabs.slice(0, MAX_SKELETON_TABS).map((tab) => (
            <Skeleton key={tab.key} className="h-4 w-16 shrink-0" />
          ))}
        </div>
      ) : null}
    </>
  )
}

function EntityHeaderSkeleton({ label, props }: { label: string; props: EntityHeaderProps }) {
  return (
    <div data-slot="entity-header" aria-busy="true" className={cn('flex flex-col gap-3', props.className)}>
      <span className="sr-only">{label}</span>
      {usesPageHeaderProps(props) ? <PageSkeletonBody props={props} /> : <LegacySkeletonBody />}
    </div>
  )
}

type BackControlProps = {
  label: string
  href: string | undefined
  onBack: (() => void) | undefined
}

function BackControl({ label, href, onBack }: BackControlProps) {
  const className =
    'inline-flex h-10 min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-md text-sm font-normal text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:shadow-focus sm:h-8'
  const content = (
    <>
      <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
    </>
  )
  return (
    <div data-slot="entity-header-back" className="-mb-2 flex min-w-0">
      {href ? (
        <a
          href={href}
          className={className}
          onClick={(event) => {
            if (!onBack || !isPlainLeftClick(event)) return
            event.preventDefault()
            onBack()
          }}
        >
          {content}
        </a>
      ) : (
        <button type="button" className={className} onClick={onBack}>
          {content}
        </button>
      )}
    </div>
  )
}

type HeaderTabsProps = {
  tabs: EntityHeaderTab[]
  activeTabKey: string | undefined
  onTabChange: ((tabKey: string) => void) | undefined
  idBase: string | undefined
  label: string
}

function HeaderTabs({ tabs, activeTabKey, onTabChange, idBase, label }: HeaderTabsProps) {
  const locale = useLocale()
  const generatedId = React.useId()
  const scrollerRef = React.useRef<HTMLDivElement>(null)
  const [fade, setFade] = React.useState({ start: false, end: false })
  const numberFormat = React.useMemo(() => new Intl.NumberFormat(locale), [locale])

  const updateFade = React.useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const maxScroll = scroller.scrollWidth - scroller.clientWidth
    const start = scroller.scrollLeft > 1
    const end = scroller.scrollLeft < maxScroll - 1
    setFade((current) => (current.start === start && current.end === end ? current : { start, end }))
  }, [])

  React.useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return undefined
    updateFade()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(updateFade)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [tabs, updateFade])

  React.useEffect(() => {
    const scroller = scrollerRef.current
    const active = scroller?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    if (!scroller || !active) return
    const bounds = scroller.getBoundingClientRect()
    const rect = active.getBoundingClientRect()
    const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth)
    const offset =
      rect.left < bounds.left + TAB_SCROLL_MARGIN
        ? rect.left - (bounds.left + TAB_SCROLL_MARGIN)
        : rect.right > bounds.right - TAB_SCROLL_MARGIN
          ? rect.right - (bounds.right - TAB_SCROLL_MARGIN)
          : 0
    const nextScroll = Math.min(maxScroll, Math.max(0, scroller.scrollLeft + offset))
    if (nextScroll !== scroller.scrollLeft) scroller.scrollLeft = nextScroll
    updateFade()
  }, [activeTabKey, tabs, updateFade])

  const activeTab = tabs.find((tab) => tab.key === activeTabKey && tab.disabled !== true)
  const focusableKey = (activeTab ?? tabs.find((tab) => tab.disabled !== true))?.key

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const enabled = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]:not([disabled])'))
    const currentIndex = enabled.indexOf(document.activeElement as HTMLElement)
    if (currentIndex < 0) return
    event.preventDefault()
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? enabled.length - 1
          : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length
    const target = enabled[nextIndex]
    target.focus()
    const targetTab = tabs.find((tab) => tab.key === target.dataset.tabKey)
    if (targetTab && !targetTab.href && targetTab.key !== activeTabKey) onTabChange?.(targetTab.key)
  }

  return (
    <div data-slot="entity-header-tabs" className="relative">
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 border-b border-input" />
      <div
        ref={scrollerRef}
        data-slot="entity-header-tabs-scroller"
        data-fade-start={fade.start ? 'true' : undefined}
        data-fade-end={fade.end ? 'true' : undefined}
        onScroll={updateFade}
        className={cn(
          'scrollbar-hide relative -ml-1 overflow-x-auto',
          fade.start && 'mask-l-from-90%',
          fade.end && 'mask-r-from-90%',
        )}
      >
        <div role="tablist" aria-label={label} aria-orientation="horizontal" onKeyDown={handleKeyDown} className="flex w-max items-center gap-4">
          {tabs.map((tab, index) => {
            const selected = tab.key === activeTabKey
            const ids = idBase ? entityHeaderTabIds(idBase, tab.key) : null
            const Icon = resolveIcon(tab.icon)
            const shared = {
              role: 'tab',
              id: ids ? ids.tabId : `${generatedId}-tab-${index}`,
              'aria-selected': selected,
              'aria-controls': selected && ids ? ids.panelId : undefined,
              tabIndex: tab.key === focusableKey ? 0 : -1,
              'data-slot': 'entity-header-tab',
              'data-tab-key': tab.key,
              'data-state': selected ? 'active' : 'inactive',
              className: cn(
                'relative inline-flex h-10 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-t-md px-1 text-sm font-normal outline-none transition-colors',
                'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                'disabled:pointer-events-none disabled:cursor-not-allowed disabled:text-text-disabled',
                selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              ),
            }
            const content = (
              <>
                {Icon ? <Icon aria-hidden="true" className="size-4 shrink-0" /> : null}
                <span>{tab.label}</span>
                {tab.count !== undefined ? (
                  <span
                    data-slot="entity-header-tab-count"
                    className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-muted px-2 text-xs text-muted-foreground"
                  >
                    {numberFormat.format(tab.count)}
                  </span>
                ) : null}
                {selected ? (
                  <span aria-hidden="true" className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-accent-indigo" />
                ) : null}
              </>
            )
            if (tab.href && tab.disabled !== true) {
              return (
                <a
                  key={tab.key}
                  {...shared}
                  href={tab.href}
                  onClick={(event) => {
                    if (!onTabChange || !isPlainLeftClick(event)) return
                    event.preventDefault()
                    onTabChange(tab.key)
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== ' ') return
                    event.preventDefault()
                    event.currentTarget.click()
                  }}
                >
                  {content}
                </a>
              )
            }
            return (
              <button
                key={tab.key}
                {...shared}
                type="button"
                disabled={tab.disabled === true}
                onClick={() => {
                  if (tab.key !== activeTabKey) onTabChange?.(tab.key)
                }}
              >
                {content}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function MetaValue({ item }: { item: EntityHeaderMeta }) {
  return (
    <dd className="min-w-0 break-words text-foreground">
      {item.href ? (
        <a
          href={item.href}
          data-slot="entity-header-meta-link"
          className="-my-2 inline-block max-w-full rounded-sm py-2 text-foreground underline decoration-border underline-offset-4 outline-none transition-colors hover:decoration-foreground focus-visible:shadow-focus"
        >
          {item.value}
        </a>
      ) : (
        item.value
      )}
      {item.suffix ? (
        <span data-slot="entity-header-meta-suffix" className="ml-1 text-muted-foreground">
          {item.suffix}
        </span>
      ) : null}
    </dd>
  )
}

function formatLabelList(labels: string[], locale: string): string {
  if (typeof Intl.ListFormat !== 'function') return labels.join(', ')
  return new Intl.ListFormat(locale, { style: 'short', type: 'unit' }).format(labels)
}

type HeaderBadgesProps = {
  badges: BlockToneLabel[]
  maxVisible: number | undefined
}

function HeaderBadges({ badges, maxVisible }: HeaderBadgesProps) {
  const t = useT()
  const locale = useLocale()
  const visible = maxVisible === undefined ? badges : badges.slice(0, maxVisible)
  const hidden = badges.slice(visible.length)
  const hiddenLabels = formatLabelList(
    hidden.map((badge) => badge.label),
    locale,
  )
  return (
    <>
      {visible.map((badge, index) => (
        <StatusBadge key={`${index}-${badge.label}`} variant={badge.tone}>
          {badge.label}
        </StatusBadge>
      ))}
      {hidden.length > 0 ? (
        <SimpleTooltip content={hiddenLabels}>
          <span
            tabIndex={0}
            data-slot="entity-header-badges-overflow"
            className="inline-flex cursor-default rounded-full outline-none focus-visible:shadow-focus"
          >
            <StatusBadge variant="neutral">
              <span aria-hidden="true" className="tabular-nums">
                {t('ui.blocks.entityHeader.moreBadges', '+{count}', { count: hidden.length })}
              </span>
              <span className="sr-only">
                {t('ui.blocks.entityHeader.moreBadgesList', '{count} more: {labels}', {
                  count: hidden.length,
                  labels: hiddenLabels,
                })}
              </span>
            </StatusBadge>
          </span>
        </SimpleTooltip>
      ) : null}
    </>
  )
}

export function EntityHeader(props: EntityHeaderProps) {
  const t = useT()
  const {
    title,
    subtitle,
    avatar,
    badge,
    badges,
    maxVisibleBadges,
    status,
    meta,
    actions,
    destructivePlacement = 'overflow',
    primaryActionKey,
    onAction,
    onRetry,
    leading,
    trailing,
    below,
    count,
    backLabel,
    backHref,
    onBack,
    tabs,
    activeTabKey,
    onTabChange,
    tabsLabel,
    idBase,
    errorMessage,
    className,
  } = props
  const locale = useLocale()
  const reasonIdBase = React.useId()
  const [pendingKeys, setPendingKeys] = React.useState<ReadonlySet<string>>(() => new Set())

  const runAction = React.useCallback(
    (key: string) => {
      const result = onAction?.(key)
      if (!result || typeof (result as Promise<void>).then !== 'function') return
      setPendingKeys((current) => new Set(current).add(key))
      const clear = () =>
        setPendingKeys((current) => {
          const next = new Set(current)
          next.delete(key)
          return next
        })
      ;(result as Promise<void>).then(clear, clear)
    },
    [onAction],
  )

  const split = React.useMemo(
    () => splitActions(actions ?? [], primaryActionKey, destructivePlacement),
    [actions, primaryActionKey, destructivePlacement],
  )

  if (status === 'loading') {
    return <EntityHeaderSkeleton label={t('ui.blocks.entityHeader.loading', 'Loading')} props={props} />
  }

  const hasLeading = Boolean(leading) || Boolean(avatar)
  const leadingNode = leading ? (
    <div data-slot="entity-header-leading" className="flex shrink-0">
      {leading}
    </div>
  ) : avatar ? (
    <Avatar label={avatar.initials} src={avatar.src} size="lg" variant={avatar.variant} className="font-normal" />
  ) : null
  const titleNode = (
    <h1 className="min-w-0 break-words text-xl font-normal leading-tight text-foreground sm:text-2xl">{title}</h1>
  )

  const backNode = backLabel ? <BackControl label={backLabel} href={backHref} onBack={onBack} /> : null
  const formattedCount = count === undefined ? null : new Intl.NumberFormat(locale).format(count)
  const countNode =
    formattedCount === null ? null : (
      <span data-slot="entity-header-count" className="text-xl font-normal leading-tight text-muted-foreground sm:text-2xl">
        <span aria-hidden="true">{formattedCount}</span>
        <span className="sr-only">{t('ui.blocks.entityHeader.count', 'Total: {count}', { count: formattedCount })}</span>
      </span>
    )

  if (status === 'error') {
    const errorBody = (
      <>
        {leadingNode}
        <div className="min-w-0 flex-1">
          {titleNode}
          <ErrorMessage
            label={errorMessage ?? t('ui.blocks.entityHeader.error', 'Something went wrong')}
            className="mt-3 max-w-xl rounded-md"
            action={
              onRetry ? (
                <Button type="button" size="sm" variant="outline" className="h-10 text-foreground sm:h-8" onClick={onRetry}>
                  {t('ui.blocks.entityHeader.retry', 'Try again')}
                </Button>
              ) : undefined
            }
          />
        </div>
      </>
    )
    if (!backNode) {
      return (
        <div data-slot="entity-header" className={cn('flex items-start gap-4', className)}>
          {errorBody}
        </div>
      )
    }
    return (
      <div data-slot="entity-header" className={cn('flex flex-col gap-3', className)}>
        {backNode}
        <div className="flex items-start gap-4">{errorBody}</div>
      </div>
    )
  }

  const reasonIdFor = (action: EntityHeaderAction) => `${reasonIdBase}-${action.key}`
  const visibleActions = split.primary ? [...split.secondary, split.primary] : split.secondary
  const actionsWithReason = visibleActions.filter(hasDisabledReason)
  const hasButtons = visibleActions.length > 0 || split.overflow.length > 0
  const interceptLinkClicks = onAction !== undefined
  const hasMetaLinks = Boolean(meta?.some((item) => item.href))

  return (
    <div data-slot="entity-header" className={cn('flex flex-col gap-3', className)}>
      {backNode}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          {leadingNode}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {titleNode}
              {countNode}
              {badge ? <StatusBadge variant={badge.tone}>{badge.label}</StatusBadge> : null}
              {badges && badges.length > 0 ? <HeaderBadges badges={badges} maxVisible={maxVisibleBadges} /> : null}
            </div>
            {subtitle ? <p className="mt-1 text-sm leading-5 text-muted-foreground">{subtitle}</p> : null}
            {meta && meta.length > 0 ? (
              <dl
                data-slot="entity-header-meta"
                className={cn(
                  'mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:flex sm:flex-wrap',
                  hasMetaLinks ? 'sm:gap-y-3' : 'sm:gap-y-1',
                )}
              >
                {meta.map((item) => (
                  <div key={item.key} className="flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-2">
                    <dt className="min-w-0 break-words text-muted-foreground">{item.label}</dt>
                    <MetaValue item={item} />
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        </div>
        {hasButtons || trailing ? (
          <div data-slot="entity-header-actions" className="flex min-w-0 flex-col gap-2 sm:items-end">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
              {trailing ? (
                <div
                  data-slot="entity-header-trailing"
                  className={cn('flex min-w-0 items-center', hasLeading && 'pl-16 sm:pl-0')}
                >
                  {trailing}
                </div>
              ) : null}
              {hasButtons ? (
                <div data-slot="entity-header-buttons" className="flex min-w-0 flex-wrap items-center gap-2">
                  {split.secondary.map((action) => (
                    <ActionButton
                      key={action.key}
                      action={action}
                      variant="outline"
                      pending={pendingKeys.has(action.key)}
                      reasonId={reasonIdFor(action)}
                      interceptLinkClicks={interceptLinkClicks}
                      onRun={runAction}
                    />
                  ))}
                  {split.primary ? (
                    <ActionButton
                      action={split.primary}
                      variant="default"
                      pending={pendingKeys.has(split.primary.key)}
                      reasonId={reasonIdFor(split.primary)}
                      interceptLinkClicks={interceptLinkClicks}
                      onRun={runAction}
                    />
                  ) : null}
                  {split.overflow.length > 0 ? (
                    <OverflowMenu
                      actions={split.overflow}
                      pendingKeys={pendingKeys}
                      interceptLinkClicks={interceptLinkClicks}
                      onRun={runAction}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
            {actionsWithReason.map((action) => (
              <p
                key={action.key}
                id={reasonIdFor(action)}
                data-slot="entity-header-action-reason"
                className="text-xs leading-5 text-muted-foreground md:sr-only"
              >
                {action.disabledReason}
              </p>
            ))}
          </div>
        ) : null}
      </div>
      {below ? (
        <div data-slot="entity-header-below" className={cn(hasLeading && 'md:pl-16')}>
          {below}
        </div>
      ) : null}
      {tabs && tabs.length > 0 ? (
        <HeaderTabs
          tabs={tabs}
          activeTabKey={activeTabKey}
          onTabChange={onTabChange}
          idBase={idBase}
          label={tabsLabel ?? t('ui.blocks.entityHeader.tabs', 'Sections')}
        />
      ) : null}
    </div>
  )
}
