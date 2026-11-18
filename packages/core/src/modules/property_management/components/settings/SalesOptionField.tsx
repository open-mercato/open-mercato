"use client"

import * as React from 'react'
import Link from 'next/link'
import type { CrudCustomFieldRenderProps, CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const NONE = '__none__'

export type SalesOptionFieldProps = CrudCustomFieldRenderProps & {
  label: string
  loadOptions: () => Promise<CrudFieldOption[]>
  emptyMessage: string
  emptyActionLabel: string
  emptyHref: string | null
}

export function SalesOptionField({ id, value, setValue, disabled, label, loadOptions, emptyMessage, emptyActionLabel, emptyHref }: SalesOptionFieldProps) {
  const t = useT()
  const [options, setOptions] = React.useState<CrudFieldOption[] | null>(null)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [attempt, setAttempt] = React.useState(0)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const retryRef = React.useRef<HTMLButtonElement>(null)
  const focusTriggerRef = React.useRef(false)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    loadOptions().then(
      (loaded) => {
        if (cancelled) return
        focusTriggerRef.current = Boolean(retryRef.current && document.activeElement === retryRef.current)
        setOptions(loaded)
        setLoadFailed(false)
        setLoading(false)
      },
      () => {
        if (cancelled) return
        setOptions((current) => current ?? [])
        setLoadFailed(true)
        setLoading(false)
      },
    )
    return () => {
      cancelled = true
    }
  }, [loadOptions, attempt])

  React.useEffect(() => {
    if (loading || !focusTriggerRef.current) return
    focusTriggerRef.current = false
    triggerRef.current?.focus()
  }, [loading])

  const retry = () => {
    if (loading) return
    setAttempt((value) => value + 1)
  }

  const selected = typeof value === 'string' && value ? value : NONE
  const empty = !loadFailed && options !== null && options.length === 0
  const listed = options ?? []
  const savedUnlisted = options !== null && selected !== NONE && !listed.some((option) => option.value === selected)
  const savedMissing = savedUnlisted && !loadFailed
  const savedUnverified = savedUnlisted && loadFailed

  return (
    <div className="space-y-1">
      <Select value={selected} onValueChange={(next) => setValue(next === NONE ? '' : next)} disabled={disabled || options === null || loading}>
        <SelectTrigger ref={triggerRef} id={`pm-settings-${id}`} aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t('property_management.settings.none', 'Not set')}</SelectItem>
          {savedMissing ? <SelectItem value={selected}>{t('property_management.settings.savedOptionMissing', 'Saved option (not listed)')}</SelectItem> : null}
          {savedUnverified ? <SelectItem value={selected}>{t('property_management.settings.savedOptionUnverified', 'Current value (options could not be loaded)')}</SelectItem> : null}
          {listed.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {loadFailed ? (
        <div className="flex flex-wrap items-center gap-2" role="alert" data-testid={`pm-settings-${id}-error`}>
          <p className="text-sm text-status-error-text">
            {t('property_management.settings.optionsLoadError', 'Could not load the options. You may not have access to them, or try again later.')}
          </p>
          <Button
            ref={retryRef}
            type="button"
            variant="outline"
            size="sm"
            onClick={retry}
            aria-disabled={loading || undefined}
            aria-busy={loading || undefined}
            className={loading ? 'cursor-not-allowed opacity-60' : undefined}
            data-testid={`pm-settings-${id}-retry`}
          >
            {t('property_management.common.retry', 'Try again')}
          </Button>
        </div>
      ) : null}
      {empty ? (
        <p className="text-sm text-muted-foreground" data-testid={`pm-settings-${id}-empty`}>
          {emptyMessage}
          {emptyHref ? (
            <>
              {' '}
              <Link href={emptyHref} className="font-medium underline">{emptyActionLabel}</Link>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}
