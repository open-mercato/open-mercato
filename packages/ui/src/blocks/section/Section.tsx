"use client"

import * as React from 'react'
import { ChevronDown, CircleAlert, Inbox, MoreHorizontal } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { cn } from '@open-mercato/shared/lib/utils'
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
import type { BlockAction } from '../contracts/shared'
import type { SectionProps, SectionTone, SectionVariant } from '../contracts/section'

const DEFAULT_MAX_VISIBLE_ACTIONS = 3
const PHONE_MAX_VISIBLE_ACTIONS = 0
const WIDE_VIEWPORT_QUERY = '(min-width: 40rem)'

const GHOST_DISABLED_CLASS =
  'cursor-not-allowed bg-transparent text-text-disabled hover:bg-transparent hover:text-text-disabled dark:hover:bg-transparent'

const CONTROL_HEIGHT_CLASS = 'h-10 sm:h-8'
const CONTROL_SIZE_CLASS = 'size-10 sm:size-8'
const CONTROL_ROW_CLASS = 'min-h-10 sm:min-h-8'

const ROOT_CLASS: Record<SectionVariant, string> = {
  card: '@container/section min-w-0 rounded-card border border-border bg-card text-card-foreground',
  plain:
    '@container/section min-w-0 [[data-slot=section][data-variant=plain]+&]:mt-6 [[data-slot=section][data-variant=plain]+&]:border-t [[data-slot=section][data-variant=plain]+&]:border-border [[data-slot=section][data-variant=plain]+&]:pt-6',
}

const ICON_TONE_CLASS: Record<SectionTone, string> = {
  neutral: 'text-muted-foreground',
  error: 'text-status-error-icon',
}

const SKELETON_VALUE_WIDTHS = ['w-40', 'w-56', 'w-32']
const SKELETON_FLUSH_WIDTHS = ['w-40', 'w-32', 'w-48']

const logger = createLogger('ui')
const reportedUnknownIcons = new Set<string>()

function resolveIcon(name: string | undefined) {
  const Icon = resolveRegisteredLucideIcon(name)
  if (Icon || !name || process.env.NODE_ENV === 'production' || reportedUnknownIcons.has(name)) return Icon
  reportedUnknownIcons.add(name)
  logger.warn('[internal] Section received an icon name that is not in the icon registry', { icon: name })
  return Icon
}

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

function isPlainLeftClick(event: React.MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

function isPromise(value: void | Promise<void>): value is Promise<void> {
  return Boolean(value) && typeof (value as Promise<void>).then === 'function'
}

function rendersAsLink(action: BlockAction): boolean {
  return Boolean(action.href) && action.disabled !== true
}

function hasDisabledReason(action: BlockAction): boolean {
  return action.disabled === true && Boolean(action.disabledReason)
}

type ActionSplit = { visible: BlockAction[]; overflow: BlockAction[] }

function splitActions(actions: BlockAction[], maxVisible: number): ActionSplit {
  const visible: BlockAction[] = []
  const overflow: BlockAction[] = []
  for (const action of actions) {
    if (action.tone !== 'destructive' && visible.length < maxVisible) visible.push(action)
    else overflow.push(action)
  }
  return { visible, overflow }
}

function ActionIcon({ name }: { name: string | undefined }) {
  const Icon = resolveIcon(name)
  if (!Icon) return null
  return <Icon aria-hidden="true" className="size-4" />
}

function hasResolvableIcon(action: BlockAction): boolean {
  return Boolean(resolveIcon(action.icon))
}

type ActionAppearance = 'label' | 'icon' | 'invitation'

type ActionButtonProps = {
  action: BlockAction
  appearance: ActionAppearance
  pending: boolean
  reasonId: string
  slotName?: string
  onRun: (key: string) => void
}

function ActionButton({ action, appearance, pending, reasonId, slotName = 'section-action', onRun }: ActionButtonProps) {
  const hasReason = hasDisabledReason(action)
  const ariaDisabled = hasReason && !pending
  const asLink = rendersAsLink(action)
  const hasIcon = hasResolvableIcon(action)
  const iconOnly = appearance === 'icon' && hasIcon
  const quiet = appearance !== 'invitation'
  const looksDisabled = ariaDisabled || (asLink && pending)
  const leading = pending ? <Spinner size="sm" /> : <ActionIcon name={action.icon} />
  const handleLinkClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (pending) {
      event.preventDefault()
      return
    }
    if (event.defaultPrevented || !isPlainLeftClick(event)) return
    event.preventDefault()
    onRun(action.key)
  }
  const handleButtonClick = () => {
    if (ariaDisabled) return
    onRun(action.key)
  }
  const shared = {
    'data-slot': slotName,
    'data-appearance': iconOnly ? 'icon' : 'label',
    'aria-label': action.label,
    'aria-busy': pending || undefined,
  }
  const linkProps = { ...shared, 'aria-disabled': pending ? ('true' as const) : undefined }
  const buttonProps = {
    ...shared,
    type: 'button' as const,
    disabled: (action.disabled === true && !hasReason) || pending,
    'aria-disabled': ariaDisabled ? ('true' as const) : undefined,
    'aria-describedby': hasReason ? reasonId : undefined,
    onClick: handleButtonClick,
  }

  if (iconOnly) {
    const className = cn(
      CONTROL_SIZE_CLASS,
      'shrink-0 text-muted-foreground hover:text-foreground disabled:bg-transparent',
      looksDisabled && GHOST_DISABLED_CLASS,
    )
    const control = asLink ? (
      <IconButton asChild variant="ghost" className={className} {...linkProps}>
        <a href={action.href} onClick={handleLinkClick}>
          {leading}
        </a>
      </IconButton>
    ) : (
      <IconButton variant="ghost" className={className} {...buttonProps}>
        {leading}
      </IconButton>
    )
    return <SimpleTooltip content={action.disabledReason ?? action.label}>{control}</SimpleTooltip>
  }

  const className = cn(
    CONTROL_HEIGHT_CLASS,
    'min-w-0 shrink font-normal',
    quiet && 'disabled:bg-transparent',
    quiet && looksDisabled && GHOST_DISABLED_CLASS,
    !quiet && looksDisabled && 'cursor-not-allowed text-text-disabled hover:bg-control hover:text-text-disabled',
  )
  const content = (
    <>
      {pending || hasIcon ? leading : null}
      <span className={cn('min-w-0 truncate', quiet && hasIcon && 'hidden @md/section:inline')}>{action.label}</span>
    </>
  )
  const variant = quiet ? 'ghost' : 'outline'
  const control = asLink ? (
    <Button asChild size="sm" variant={variant} className={className} {...linkProps}>
      <a href={action.href} onClick={handleLinkClick}>
        {content}
      </a>
    </Button>
  ) : (
    <Button size="sm" variant={variant} className={className} {...buttonProps}>
      {content}
    </Button>
  )
  if (!hasReason) return control
  return <SimpleTooltip content={action.disabledReason}>{control}</SimpleTooltip>
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
        data-slot="section-menu-link"
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
  title: string
  actions: BlockAction[]
  pendingKeys: ReadonlySet<string>
  onRun: (key: string) => void
}

function OverflowMenu({ title, actions, pendingKeys, onRun }: OverflowMenuProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const anyPending = actions.some((action) => pendingKeys.has(action.key))
  return (
    <Dropdown open={open} onOpenChange={setOpen}>
      <DropdownTrigger asChild>
        <IconButton
          type="button"
          variant="ghost"
          data-slot="section-more"
          className={cn(
            CONTROL_SIZE_CLASS,
            'shrink-0 text-muted-foreground hover:text-foreground disabled:bg-transparent data-[state=open]:bg-accent data-[state=open]:text-foreground',
          )}
          disabled={anyPending}
          aria-busy={anyPending || undefined}
          aria-label={t('ui.blocks.section.moreActions', 'More actions for {title}', { title })}
        >
          {anyPending ? <Spinner size="sm" /> : <MoreHorizontal aria-hidden="true" />}
        </IconButton>
      </DropdownTrigger>
      <DropdownContent align="end" className="w-56">
        <DropdownList>
          {actions.map((action) => {
            if (rendersAsLink(action)) {
              return <OverflowLinkItem key={action.key} action={action} onClose={() => setOpen(false)} onRun={onRun} />
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

function SectionSkeleton({ label, flush }: { label: string; flush: boolean }) {
  if (flush) {
    return (
      <div data-slot="section-skeleton" data-shape="rows" className="flex flex-col">
        <span className="sr-only">{label}</span>
        {SKELETON_FLUSH_WIDTHS.map((width) => (
          <div
            key={width}
            aria-hidden="true"
            className="flex h-10 items-center gap-4 border-t border-border px-4 first-of-type:border-t-0"
          >
            <Skeleton className={cn('h-4 max-w-full', width)} />
            <Skeleton className="ml-auto h-4 w-12" />
          </div>
        ))}
      </div>
    )
  }
  return (
    <div data-slot="section-skeleton" data-shape="facts" className="flex flex-col gap-3">
      <span className="sr-only">{label}</span>
      {SKELETON_VALUE_WIDTHS.map((width) => (
        <div key={width} aria-hidden="true" className="flex h-5 items-center gap-4">
          <Skeleton className="h-4 w-24 shrink-0" />
          <Skeleton className={cn('h-4 max-w-full', width)} />
        </div>
      ))}
    </div>
  )
}

function useCollapsedState(
  collapsible: boolean,
  controlled: boolean | undefined,
  defaultCollapsed: boolean,
  onCollapsedChange: ((collapsed: boolean) => void) | undefined,
): [boolean, () => void] {
  const [internal, setInternal] = React.useState(defaultCollapsed)
  const isControlled = controlled !== undefined
  const collapsed = collapsible && (isControlled ? controlled : internal)
  const toggle = React.useCallback(() => {
    const next = !collapsed
    if (!isControlled) setInternal(next)
    onCollapsedChange?.(next)
  }, [collapsed, isControlled, onCollapsedChange])
  return [collapsed, toggle]
}

function isRenderable(node: React.ReactNode): boolean {
  return node !== undefined && node !== null && node !== false
}

export function Section(props: SectionProps) {
  const t = useT()
  const {
    title,
    description,
    icon,
    count,
    headingLevel = 2,
    actions,
    maxVisibleActions,
    onAction,
    variant = 'card',
    tone = 'neutral',
    padding = 'default',
    layout = 'stacked',
    divider,
    collapsible = false,
    defaultCollapsed = false,
    collapsed: controlledCollapsed,
    onCollapsedChange,
    summary,
    children,
    footer,
    footerNote,
    headerTrailing,
    status,
    errorMessage,
    onRetry,
    emptyState,
    emptyTitle,
    emptyDescription,
    className,
  } = props
  const headingId = React.useId()
  const bodyId = React.useId()
  const reasonIdBase = React.useId()
  const isPhone = useIsPhoneViewport()
  const [collapsed, toggleCollapsed] = useCollapsedState(
    collapsible,
    controlledCollapsed,
    defaultCollapsed,
    onCollapsedChange,
  )
  const [pendingKeys, setPendingKeys] = React.useState<ReadonlySet<string>>(() => new Set())

  const runAction = React.useCallback(
    (key: string) => {
      const result = onAction?.(key)
      if (!isPromise(result)) return
      setPendingKeys((current) => new Set(current).add(key))
      const clear = () =>
        setPendingKeys((current) => {
          const next = new Set(current)
          next.delete(key)
          return next
        })
      result.then(clear, clear)
    },
    [onAction],
  )

  const visibleLimit = isPhone ? PHONE_MAX_VISIBLE_ACTIONS : (maxVisibleActions ?? DEFAULT_MAX_VISIBLE_ACTIONS)
  const split = React.useMemo(() => splitActions(actions ?? [], visibleLimit), [actions, visibleLimit])
  const reasonIdFor = (action: BlockAction) => `${reasonIdBase}-${action.key}`
  const actionsWithReason = split.visible.filter(hasDisabledReason)
  const hasButtons = split.visible.length > 0 || split.overflow.length > 0
  const invitationAction = (actions ?? []).find((action) => action.tone !== 'destructive')

  const isCard = variant === 'card'
  const isError = tone === 'error'
  const isSplit = layout === 'split'
  const isReady = status === undefined || status === 'ready'
  const flush = padding === 'none' && (isReady || status === 'loading')
  const showDivider = divider ?? padding === 'none'
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4'
  const hasHeaderControls = isRenderable(headerTrailing) || hasButtons
  const tallOnPhone = collapsible || hasHeaderControls
  const TitleIcon = resolveIcon(icon) ?? (isError ? CircleAlert : undefined)
  const showSummary = collapsed && Boolean(summary)

  let body: React.ReactNode = children
  if (status === 'loading') {
    body = (
      <SectionSkeleton
        label={t('ui.blocks.section.loading', 'Loading {title}', { title })}
        flush={padding === 'none'}
      />
    )
  } else if (status === 'error') {
    body = (
      <ErrorMessage
        label={errorMessage ?? t('ui.blocks.section.error', 'Could not load this section')}
        className="border-0 bg-transparent px-0 py-0"
        action={
          onRetry ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={cn(CONTROL_HEIGHT_CLASS, 'font-normal text-foreground')}
              onClick={onRetry}
            >
              {t('ui.blocks.section.retry', 'Try again')}
            </Button>
          ) : undefined
        }
      />
    )
  } else if (status === 'empty') {
    body = emptyState ?? (
      <EmptyState
        size="sm"
        className="[&_p]:font-normal"
        icon={<Inbox aria-hidden="true" />}
        title={emptyTitle ?? t('ui.blocks.section.empty', 'Nothing here yet')}
        description={
          emptyDescription ?? t('ui.blocks.section.emptyDescription', 'Content will appear here once it is added.')
        }
        actions={
          invitationAction ? (
            <ActionButton
              action={invitationAction}
              appearance="invitation"
              slotName="section-empty-action"
              pending={pendingKeys.has(invitationAction.key)}
              reasonId={reasonIdFor(invitationAction)}
              onRun={runAction}
            />
          ) : undefined
        }
      />
    )
  }

  const hasBody = isRenderable(body)
  const bodyShown = hasBody && !collapsed
  const showFooter = isReady && !collapsed && (isRenderable(footer) || Boolean(footerNote))
  const headerIsStrip = isCard && (showDivider || isError || !bodyShown)

  return (
    <section
      aria-labelledby={headingId}
      aria-busy={status === 'loading' ? true : undefined}
      data-slot="section"
      data-variant={variant}
      data-tone={tone}
      data-layout={layout}
      data-state={collapsible ? (collapsed ? 'collapsed' : 'expanded') : undefined}
      className={cn(ROOT_CLASS[variant], className)}
    >
      <div
        data-slot="section-main"
        className={cn(
          isSplit && '@2xl/section:grid @2xl/section:grid-cols-3',
          isSplit && !isCard && '@2xl/section:gap-x-8',
          !isCard && isError && 'border-l-2 border-status-error-icon pl-4',
        )}
      >
        <div
          data-slot="section-header"
          className={cn(
            'relative flex items-start gap-3',
            isCard && 'rounded-t-card px-4 pt-4',
            isCard && (headerIsStrip || isSplit ? 'pb-4' : 'pb-3'),
            isCard && !bodyShown && !showFooter && 'rounded-b-card',
            isCard && isError && 'bg-status-error-bg',
            !isCard && bodyShown && (showDivider || isSplit ? 'pb-4' : 'pb-3'),
            !isCard && isSplit && '@2xl/section:pb-0',
            isCard &&
              collapsible &&
              !isError &&
              'transition-colors has-[[data-slot=section-toggle]:hover]:bg-muted/60',
            collapsible && 'group/section-header',
          )}
        >
          <div
            className={cn(
              'flex min-w-0 items-start gap-2',
              showSummary ? 'flex-1 @md/section:max-w-1/2 @md/section:flex-initial' : 'flex-1 basis-40',
            )}
          >
            {TitleIcon ? (
              <TitleIcon
                aria-hidden="true"
                data-slot="section-icon"
                className={cn('size-4 shrink-0', tallOnPhone ? 'mt-3 sm:mt-2' : 'mt-2', ICON_TONE_CLASS[tone])}
              />
            ) : null}
            <div className="flex min-w-0 flex-1 flex-col">
              <div
                data-slot="section-title-line"
                className={cn('min-w-0 break-words text-base leading-6', tallOnPhone ? 'py-2 sm:py-1' : 'py-1')}
              >
                <Heading id={headingId} data-slot="section-title" className="inline font-normal text-foreground">
                  {collapsible ? (
                    <button
                      type="button"
                      data-slot="section-toggle"
                      aria-expanded={!collapsed}
                      aria-controls={bodyId}
                      className="-mx-1 cursor-pointer rounded-sm px-1 text-left outline-none after:absolute after:inset-0 focus-visible:shadow-focus"
                      onClick={toggleCollapsed}
                    >
                      {title}
                    </button>
                  ) : (
                    title
                  )}
                </Heading>
                {count !== undefined ? (
                  <span data-slot="section-count" className="ml-2 whitespace-nowrap tabular-nums text-muted-foreground">
                    <span aria-hidden="true">{count}</span>
                    <span className="sr-only">{t('ui.blocks.section.count', '{count} items', { count })}</span>
                  </span>
                ) : null}
              </div>
              {description && !collapsed ? (
                <p data-slot="section-description" className="break-words text-sm leading-5 text-muted-foreground">
                  {description}
                </p>
              ) : null}
              {showSummary ? (
                <p
                  data-slot="section-summary"
                  data-placement="below"
                  className="truncate text-sm leading-5 text-muted-foreground @md/section:hidden"
                >
                  {summary}
                </p>
              ) : null}
            </div>
          </div>
          {showSummary ? (
            <div
              data-slot="section-summary"
              data-placement="trailing"
              className={cn(
                'hidden min-w-0 flex-1 items-center justify-end @md/section:flex',
                CONTROL_ROW_CLASS,
              )}
            >
              <span className="truncate text-sm leading-5 text-muted-foreground">{summary}</span>
            </div>
          ) : null}
          {hasHeaderControls ? (
            <div className={cn('relative flex min-w-0 shrink-0 items-center gap-1', CONTROL_ROW_CLASS)}>
              {hasButtons ? (
                <div data-slot="section-actions" className="flex min-w-0 items-center gap-1">
                  {split.visible.map((action, index) => (
                    <ActionButton
                      key={action.key}
                      action={action}
                      appearance={index === 0 ? 'label' : 'icon'}
                      pending={pendingKeys.has(action.key)}
                      reasonId={reasonIdFor(action)}
                      onRun={runAction}
                    />
                  ))}
                  {split.overflow.length > 0 ? (
                    <OverflowMenu title={title} actions={split.overflow} pendingKeys={pendingKeys} onRun={runAction} />
                  ) : null}
                </div>
              ) : null}
              {isRenderable(headerTrailing) ? (
                <div data-slot="section-header-trailing" className="flex min-w-0 items-center pl-1">
                  {headerTrailing}
                </div>
              ) : null}
            </div>
          ) : null}
          {collapsible ? (
            <span
              aria-hidden="true"
              data-slot="section-chevron"
              className={cn(
                'flex shrink-0 items-center justify-center text-muted-foreground transition-colors group-has-[[data-slot=section-toggle]:hover]/section-header:text-foreground',
                CONTROL_SIZE_CLASS,
              )}
            >
              <ChevronDown className={cn('size-4 motion-safe:transition-transform', !collapsed && 'rotate-180')} />
            </span>
          ) : null}
          {actionsWithReason.map((action) => (
            <p key={action.key} id={reasonIdFor(action)} data-slot="section-action-reason" className="sr-only">
              {action.disabledReason}
            </p>
          ))}
        </div>
        {hasBody ? (
          <div
            id={bodyId}
            data-slot="section-body"
            data-padding={flush ? 'none' : 'default'}
            hidden={collapsed}
            className={cn(
              'min-w-0',
              isSplit && '@2xl/section:col-span-2',
              showDivider && 'border-t border-border',
              showDivider && isSplit && '@2xl/section:border-t-0',
              isCard && !flush && 'px-4 pb-4',
              isCard && !flush && (showDivider || isError) && 'pt-4',
              isCard && !flush && isSplit && '@2xl/section:pt-6',
              isCard && flush && 'overflow-hidden',
              isCard && flush && !showFooter && 'rounded-b-card',
              !isCard && showDivider && !flush && 'pt-4',
              !isCard && isSplit && '@2xl/section:pt-2',
            )}
          >
            {body}
          </div>
        ) : null}
      </div>
      {showFooter ? (
        <div
          data-slot="section-footer"
          className={cn(
            'flex flex-wrap items-center justify-end gap-x-4 gap-y-2 border-t border-border',
            isCard ? 'px-4 py-3' : 'mt-4 pt-4',
          )}
        >
          {footerNote ? (
            <p data-slot="section-footer-note" className="mr-auto min-w-0 text-sm leading-5 text-muted-foreground">
              {footerNote}
            </p>
          ) : null}
          {isRenderable(footer) ? (
            <div data-slot="section-footer-content" className="flex min-w-0 flex-wrap items-center justify-end gap-2">
              {footer}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
