"use client"

import * as React from 'react'
import { MoreHorizontal } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
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
import { LoadingMessage } from '@open-mercato/ui/backend/detail/LoadingMessage'
import type { BlockAction } from '../contracts/shared'
import type { EntityHeaderProps } from '../contracts/entity-header'

function ActionIcon({ name }: { name: string | undefined }) {
  const Icon = resolveRegisteredLucideIcon(name)
  if (!Icon) return null
  return <Icon aria-hidden="true" className="size-4" />
}

const MAX_VISIBLE_SECONDARY_ACTIONS = 2

type ActionSplit = {
  primary: BlockAction | null
  secondary: BlockAction[]
  overflow: BlockAction[]
}

function splitActions(actions: BlockAction[], primaryActionKey: string | undefined): ActionSplit {
  const primary = actions.find((action) => action.key === primaryActionKey && action.tone !== 'destructive') ?? null
  const rest = actions.filter((action) => action !== primary)
  const secondary: BlockAction[] = []
  const overflow: BlockAction[] = []
  for (const action of rest) {
    if (action.tone !== 'destructive' && secondary.length < MAX_VISIBLE_SECONDARY_ACTIONS) secondary.push(action)
    else overflow.push(action)
  }
  return { primary, secondary, overflow }
}

type ActionButtonProps = {
  action: BlockAction
  variant: 'default' | 'outline'
  pending: boolean
  onRun: (key: string) => void
}

function ActionButton({ action, variant, pending, onRun }: ActionButtonProps) {
  const reasonId = React.useId()
  const hasReason = action.disabled === true && Boolean(action.disabledReason)
  const ariaDisabled = hasReason && !pending
  const button = (
    <Button
      type="button"
      size="sm"
      variant={variant}
      data-action-emphasis={variant === 'default' ? 'primary' : 'secondary'}
      disabled={(action.disabled === true && !hasReason) || pending}
      aria-disabled={ariaDisabled ? 'true' : undefined}
      aria-busy={pending || undefined}
      aria-describedby={hasReason ? reasonId : undefined}
      className={cn(
        'max-w-full',
        ariaDisabled &&
          'cursor-not-allowed border-border-disabled bg-bg-disabled text-text-disabled shadow-none hover:bg-bg-disabled hover:text-text-disabled',
      )}
      onClick={() => {
        if (ariaDisabled) return
        onRun(action.key)
      }}
    >
      {pending ? <Spinner size="sm" /> : <ActionIcon name={action.icon} />}
      <span className="min-w-0 truncate">{action.label}</span>
    </Button>
  )
  if (!hasReason) return button
  return (
    <>
      <SimpleTooltip content={action.disabledReason}>{button}</SimpleTooltip>
      <span id={reasonId} className="sr-only">
        {action.disabledReason}
      </span>
    </>
  )
}

type OverflowMenuProps = {
  actions: BlockAction[]
  pendingKeys: ReadonlySet<string>
  onRun: (key: string) => void
}

function OverflowMenu({ actions, pendingKeys, onRun }: OverflowMenuProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const anyPending = actions.some((action) => pendingKeys.has(action.key))
  return (
    <Dropdown open={open} onOpenChange={setOpen}>
      <DropdownTrigger asChild>
        <IconButton
          type="button"
          variant="outline"
          size="sm"
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

export function EntityHeader(props: EntityHeaderProps) {
  const t = useT()
  const {
    title,
    subtitle,
    avatar,
    badge,
    status,
    meta,
    actions,
    primaryActionKey,
    onAction,
    leading,
    trailing,
    below,
    errorMessage,
    className,
  } = props
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

  const split = React.useMemo(() => splitActions(actions ?? [], primaryActionKey), [actions, primaryActionKey])

  if (status === 'loading') {
    return <LoadingMessage label={t('ui.blocks.entityHeader.loading', 'Loading')} className={className} />
  }
  if (status === 'error') {
    return (
      <ErrorMessage
        label={errorMessage ?? t('ui.blocks.entityHeader.error', 'Something went wrong')}
        className={className}
      />
    )
  }

  return (
    <div data-slot="entity-header" className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3.5">
          {leading ? (
            <div data-slot="entity-header-leading" className="flex shrink-0">
              {leading}
            </div>
          ) : avatar ? (
            <Avatar label={avatar.initials} src={avatar.src} size="lg" />
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="min-w-0 break-words text-xl font-normal leading-tight text-foreground sm:text-2xl">{title}</h1>
              {badge ? <StatusBadge variant={badge.tone}>{badge.label}</StatusBadge> : null}
            </div>
            {subtitle ? <p className="mt-1 text-sm leading-5 text-muted-foreground">{subtitle}</p> : null}
            {meta && meta.length > 0 ? (
              <dl data-slot="entity-header-meta" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {meta.map((item) => (
                  <div key={item.key} className="flex min-w-0 items-baseline gap-1.5">
                    <dt className="min-w-0 break-words text-muted-foreground">{item.label}</dt>
                    <dd className="min-w-0 break-words text-foreground">{item.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        </div>
        {split.primary || split.secondary.length > 0 || split.overflow.length > 0 || trailing ? (
          <div data-slot="entity-header-actions" className="flex flex-wrap items-center gap-2">
            {trailing}
            {split.secondary.map((action) => (
              <ActionButton
                key={action.key}
                action={action}
                variant="outline"
                pending={pendingKeys.has(action.key)}
                onRun={runAction}
              />
            ))}
            {split.primary ? (
              <ActionButton
                action={split.primary}
                variant="default"
                pending={pendingKeys.has(split.primary.key)}
                onRun={runAction}
              />
            ) : null}
            {split.overflow.length > 0 ? (
              <OverflowMenu actions={split.overflow} pendingKeys={pendingKeys} onRun={runAction} />
            ) : null}
          </div>
        ) : null}
      </div>
      {below ? <div data-slot="entity-header-below">{below}</div> : null}
    </div>
  )
}
