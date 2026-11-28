"use client"

import * as React from 'react'
import { AlertCircle, Check, CircleDot, MoreHorizontal } from 'lucide-react'
import { useOptionalLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'
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
import { resolveRegisteredLucideIcon } from '@open-mercato/ui/backend/icons/lucideRegistryRuntime'
import type { BlockAction } from '../contracts/shared'
import type { FormSaveBarPlacement, FormSaveBarProps, FormSaveState } from '../contracts/form-save-bar'

export const FORM_SAVE_BAR_FLOATING_SPACER_CLASS = 'pb-24'

const PLACEMENT_CLASS: Record<FormSaveBarPlacement, string> = {
  floating: 'fixed inset-x-4 bottom-4 z-sticky mx-auto max-w-2xl rounded-card border border-border bg-card shadow-lg',
  container: 'sticky bottom-0 z-sticky w-full border-t border-border bg-card',
  inline: 'w-full rounded-card border border-border bg-card',
}

const ENTER_MOTION_CLASS: Record<FormSaveBarPlacement, string> = {
  floating: 'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-200',
  container: 'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200',
  inline: '',
}

const MESSAGE_TONE_CLASS: Record<FormSaveState, string> = {
  idle: 'text-muted-foreground',
  dirty: 'text-foreground',
  saving: 'text-foreground',
  saved: 'text-status-success-text',
  failed: 'text-status-error-text',
}

const logger = createLogger('ui')
const reportedUnknownIcons = new Set<string>()

function resolveIcon(name: string | undefined) {
  const Icon = resolveRegisteredLucideIcon(name)
  if (Icon || !name || process.env.NODE_ENV === 'production' || reportedUnknownIcons.has(name)) return Icon
  reportedUnknownIcons.add(name)
  logger.warn('[internal] FormSaveBar received an icon name that is not in the icon registry', { icon: name })
  return Icon
}

function isPlainLeftClick(event: React.MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

function ActionIcon({ name }: { name: string | undefined }) {
  const Icon = resolveIcon(name)
  if (!Icon) return null
  return <Icon aria-hidden="true" className="size-4" />
}

function StateIcon({ state }: { state: FormSaveState }) {
  if (state === 'saving') return <Spinner size="sm" className="shrink-0" />
  if (state === 'saved') return <Check aria-hidden="true" className="size-4 shrink-0 text-status-success-icon" />
  if (state === 'failed') return <AlertCircle aria-hidden="true" className="size-4 shrink-0 text-status-error-icon" />
  if (state === 'dirty') return <CircleDot aria-hidden="true" className="size-4 shrink-0 text-status-neutral-icon" />
  return <Check aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
}

function formatSavedTime(iso: string | undefined, locale: string | undefined): string {
  if (!iso) return ''
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}

type OverflowLinkItemProps = {
  action: BlockAction
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
        data-slot="form-save-bar-menu-link"
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
  actions: BlockAction[]
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
          className="size-10 shrink-0 sm:size-8"
          disabled={anyPending}
          aria-busy={anyPending || undefined}
          aria-label={t('ui.blocks.formSaveBar.moreActions', 'More actions')}
        >
          {anyPending ? <Spinner size="sm" /> : <MoreHorizontal aria-hidden="true" />}
        </IconButton>
      </DropdownTrigger>
      <DropdownContent align="end" side="top" className="w-56">
        <DropdownList>
          {actions.map((action) => {
            const icon = action.icon ? <ActionIcon name={action.icon} /> : undefined
            if (action.href && action.disabled !== true && !pendingKeys.has(action.key)) {
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

type SkeletonProps = { label: string; placement: FormSaveBarPlacement; className: string | undefined }

function FormSaveBarSkeleton({ label, placement, className }: SkeletonProps) {
  return (
    <div
      data-slot="form-save-bar"
      data-placement={placement}
      aria-busy="true"
      className={cn(PLACEMENT_CLASS[placement], 'px-4 py-2', className)}
    >
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-auto items-center gap-2">
          <Skeleton shape="circle" className="size-4 shrink-0" />
          <Skeleton className="h-5 w-36 max-w-full" />
        </div>
        <div className="flex grow items-center gap-2 sm:grow-0">
          <Skeleton className="h-10 w-16 sm:h-8" />
          <Skeleton className="h-10 min-w-20 flex-1 sm:h-8 sm:w-20 sm:flex-none" />
        </div>
      </div>
    </div>
  )
}

const FOCUSABLE_FIELD_SELECTOR = [
  'input:not([type="hidden"]):not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  'button:not(:disabled)',
  'a[href]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

type ReturnFocusTargetGetter = () => HTMLElement | null | undefined

function resolveReturnFocusTarget(
  getTarget: ReturnFocusTargetGetter | undefined,
  formId: string | undefined,
): HTMLElement | null {
  const requested = getTarget?.()
  if (requested && requested.isConnected) return requested
  if (!formId) return null
  const form = document.getElementById(formId)
  if (!form) return null
  if (form.hasAttribute('tabindex')) return form
  return form.querySelector<HTMLElement>(FOCUSABLE_FIELD_SELECTOR)
}

function isFocusUnplaced(): boolean {
  const active = document.activeElement
  return !active || active === document.body || !active.isConnected
}

type ReturnFocusOnHideProps = {
  barNodeRef: React.RefObject<HTMLElement | null>
  focusHeldRef: React.RefObject<boolean>
  resolveTargetRef: React.RefObject<() => HTMLElement | null>
}

function ReturnFocusOnHide({ barNodeRef, focusHeldRef, resolveTargetRef }: ReturnFocusOnHideProps) {
  React.useLayoutEffect(() => {
    return () => {
      const barNode = barNodeRef.current
      const active = document.activeElement
      const focusInsideBar = Boolean(barNode && active && barNode.contains(active))
      const focusDroppedInsideBar = focusHeldRef.current && isFocusUnplaced()
      focusHeldRef.current = false
      if (!focusInsideBar && !focusDroppedInsideBar) return
      queueMicrotask(() => {
        if (!isFocusUnplaced()) return
        resolveTargetRef.current()?.focus()
      })
    }
  }, [barNodeRef, focusHeldRef, resolveTargetRef])
  return null
}

function isPromise(value: void | Promise<void>): value is Promise<void> {
  return Boolean(value) && typeof (value as Promise<void>).then === 'function'
}

export function FormSaveBar(props: FormSaveBarProps) {
  const t = useT()
  const locale = useOptionalLocale()
  const {
    saveState,
    message,
    savedAt,
    formId,
    onSave,
    saveLabel,
    resetLabel,
    saveDisabledReason,
    onReset,
    actions,
    onAction,
    placement = 'floating',
    alwaysVisible = false,
    leading,
    trailing,
    status,
    errorMessage,
    className,
    getReturnFocusTarget,
  } = props
  const reasonId = React.useId()
  const barNodeRef = React.useRef<HTMLElement | null>(null)
  const focusHeldRef = React.useRef(false)
  const resolveTargetRef = React.useRef<() => HTMLElement | null>(() => null)
  React.useLayoutEffect(() => {
    resolveTargetRef.current = () => resolveReturnFocusTarget(getReturnFocusTarget, formId)
  }, [getReturnFocusTarget, formId])
  const attachBarNode = React.useCallback((node: HTMLDivElement | null) => {
    if (node) barNodeRef.current = node
  }, [])
  const handleBarFocus = React.useCallback(() => {
    focusHeldRef.current = true
  }, [])
  const handleBarBlur = React.useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
    if (event.target instanceof Element && event.target.matches(':disabled')) return
    focusHeldRef.current = false
  }, [])
  const [savePending, setSavePending] = React.useState(false)
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

  const state: FormSaveState = savePending ? 'saving' : saveState
  const isSaving = state === 'saving'
  const canSave = state === 'dirty' || state === 'failed'
  const visible = alwaysVisible || state !== 'idle'

  const defaultMessages: Record<FormSaveState, string> = {
    idle: t('ui.blocks.formSaveBar.idle', 'No unsaved changes'),
    dirty: t('ui.blocks.formSaveBar.dirty', 'Unsaved changes'),
    saving: t('ui.blocks.formSaveBar.saving', 'Saving'),
    saved: t('ui.blocks.formSaveBar.saved', 'Saved'),
    failed: t('ui.blocks.formSaveBar.failed', 'Could not save'),
  }
  const overridesMessage = !savePending || saveState === 'saving'
  const text =
    (overridesMessage ? message : undefined) ??
    (state === 'failed' ? errorMessage : undefined) ??
    defaultMessages[state]
  const savedTime = state === 'saved' ? formatSavedTime(savedAt, locale) : ''
  const announcement = visible && state !== 'failed' ? [text, savedTime].filter(Boolean).join(' ') : ''

  const announcer = (
    <div data-slot="form-save-bar-status" role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {announcement}
    </div>
  )

  if (status === 'loading') {
    if (!alwaysVisible) return null
    return (
      <FormSaveBarSkeleton
        label={t('ui.blocks.formSaveBar.loading', 'Loading')}
        placement={placement}
        className={className}
      />
    )
  }

  if (!visible) return announcer

  const hasReason = Boolean(saveDisabledReason) && !isSaving
  const saveText = saveLabel ?? t('ui.blocks.formSaveBar.save', 'Save')
  const resetText = resetLabel ?? t('ui.blocks.formSaveBar.reset', 'Reset')

  const handleSave = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (hasReason || !canSave) {
      event.preventDefault()
      return
    }
    if (formId) return
    const result = onSave?.()
    if (!isPromise(result)) return
    setSavePending(true)
    const clear = () => setSavePending(false)
    result.then(clear, clear)
  }

  const saveButton = (
    <Button
      type={formId ? 'submit' : 'button'}
      form={formId}
      size="sm"
      data-slot="form-save-bar-save"
      disabled={!hasReason && !canSave}
      aria-disabled={hasReason ? 'true' : undefined}
      aria-busy={isSaving || undefined}
      aria-describedby={hasReason ? reasonId : undefined}
      className={cn(
        'h-10 min-w-0 flex-1 sm:h-8 sm:flex-none',
        hasReason &&
          'cursor-not-allowed border-border-disabled bg-bg-disabled text-text-disabled shadow-none hover:bg-bg-disabled hover:text-text-disabled',
      )}
      onClick={handleSave}
    >
      {isSaving ? <Spinner size="sm" /> : null}
      <span className="min-w-0 truncate">{saveText}</span>
    </Button>
  )

  return (
    <>
      {announcer}
      <div
        ref={attachBarNode}
        role="group"
        aria-label={t('ui.blocks.formSaveBar.label', 'Form changes')}
        data-slot="form-save-bar"
        data-placement={placement}
        data-state={state}
        className={cn(PLACEMENT_CLASS[placement], ENTER_MOTION_CLASS[placement], 'px-4 py-2', className)}
        onFocus={handleBarFocus}
        onBlur={handleBarBlur}
      >
        <ReturnFocusOnHide barNodeRef={barNodeRef} focusHeldRef={focusHeldRef} resolveTargetRef={resolveTargetRef} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {leading ? (
            <div data-slot="form-save-bar-leading" className="flex min-w-0 shrink-0 items-center">
              {leading}
            </div>
          ) : null}
          <div
            data-slot="form-save-bar-message"
            role={state === 'failed' ? 'alert' : undefined}
            aria-hidden={state === 'failed' ? undefined : 'true'}
            className={cn('flex min-w-0 flex-auto items-center gap-2 text-sm leading-5', MESSAGE_TONE_CLASS[state])}
          >
            <StateIcon state={state} />
            <span className="min-w-0 break-words">{text}</span>
            {savedTime ? (
              <time dateTime={savedAt} className="shrink-0 tabular-nums text-muted-foreground">
                {savedTime}
              </time>
            ) : null}
          </div>
          {trailing ? (
            <div data-slot="form-save-bar-trailing" className="flex min-w-0 items-center">
              {trailing}
            </div>
          ) : null}
          <div data-slot="form-save-bar-actions" className="flex min-w-0 grow items-center gap-2 sm:grow-0">
            {onReset ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-slot="form-save-bar-reset"
                disabled={!canSave}
                className="h-10 max-w-full sm:h-8"
                onClick={onReset}
              >
                <span className="min-w-0 truncate">{resetText}</span>
              </Button>
            ) : null}
            {hasReason ? <SimpleTooltip content={saveDisabledReason}>{saveButton}</SimpleTooltip> : saveButton}
            {actions && actions.length > 0 ? (
              <OverflowMenu
                actions={actions}
                pendingKeys={pendingKeys}
                interceptLinkClicks={onAction !== undefined}
                onRun={runAction}
              />
            ) : null}
          </div>
          {hasReason ? (
            <p
              id={reasonId}
              data-slot="form-save-bar-reason"
              className="basis-full text-xs leading-5 text-muted-foreground md:sr-only"
            >
              {saveDisabledReason}
            </p>
          ) : null}
        </div>
      </div>
    </>
  )
}
