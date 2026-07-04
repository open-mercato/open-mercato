"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import type { EditorParticipant } from '../../../lib/calendar/editorPayload'
import { composeAccessibleName } from '../../../lib/calendar/labels'
import { searchPeopleOptions, type PersonOption } from './lookups'
import { CONTROL_BORDER, DROPDOWN_PANEL_CLASS, PersonChip, UppercaseBadge, useDropdownDismiss } from './inputs'

export function PeopleField({
  mode,
  placeholder,
  ariaLabel,
  value,
  onChange,
  includeCustomers,
  includeStaff = true,
}: {
  mode: 'multi' | 'single'
  placeholder: string
  ariaLabel: string
  value: EditorParticipant[]
  onChange(next: EditorParticipant[]): void
  includeCustomers: boolean
  /** Pass false when the staff module is not loaded — customer-only options. */
  includeStaff?: boolean
}) {
  const t = useT()
  const [query, setQuery] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const [options, setOptions] = React.useState<PersonOption[]>([])
  const [loading, setLoading] = React.useState(false)
  const close = React.useCallback(() => setOpen(false), [])
  const rootRef = useDropdownDismiss(open, close)

  React.useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const results = await searchPeopleOptions(query.trim(), { includeCustomers, includeStaff, signal: controller.signal })
        if (cancelled) return
        setOptions(results)
      } catch {
        if (!cancelled) setOptions([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 250)
    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [open, query, includeCustomers, includeStaff])

  const selectedIds = new Set(value.map((participant) => participant.userId))
  const visibleOptions = options.filter((option) => !selectedIds.has(option.userId))

  const customerBadge = (
    <UppercaseBadge className="bg-status-info-bg text-status-info-text">
      {t('customers.calendar.editor.customerBadge', 'Customer')}
    </UppercaseBadge>
  )

  return (
    <div
      ref={rootRef}
      className="relative w-full"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <div
        className={cn(
          'flex w-full flex-wrap content-center items-center gap-2 rounded-md bg-background px-2.5 py-2',
          'min-h-14',
          CONTROL_BORDER,
        )}
      >
        {value.map((participant) => (
          <PersonChip
            key={participant.userId}
            name={participant.name}
            badge={participant.isCustomer ? customerBadge : undefined}
            onRemove={() => onChange(value.filter((entry) => entry.userId !== participant.userId))}
            removeLabel={t('customers.calendar.editor.removePerson', 'Remove {name}', { name: participant.name })}
          />
        ))}
        <Input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          role="combobox"
          aria-expanded={open}
          className="min-w-36 flex-1 border-0 bg-transparent px-0 shadow-none hover:bg-transparent focus-within:border-transparent focus-within:shadow-none"
          inputClassName="text-sm text-foreground placeholder:text-muted-foreground"
        />
      </div>
      {open ? (
        <div role="listbox" aria-label={ariaLabel} className={DROPDOWN_PANEL_CLASS}>
          {loading ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              {t('customers.calendar.editor.searching', 'Searching…')}
            </p>
          ) : null}
          {!loading && visibleOptions.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              {t('customers.calendar.editor.noResults', 'No results')}
            </p>
          ) : null}
          {!loading
            ? visibleOptions.map((option) => (
                <Button
                  key={`${option.isCustomer ? 'customer' : 'staff'}:${option.userId}`}
                  type="button"
                  variant="ghost"
                  role="option"
                  aria-selected={false}
                  aria-label={composeAccessibleName([
                    option.name,
                    option.email,
                    option.isCustomer ? t('customers.calendar.editor.customerBadge', 'Customer') : null,
                  ])}
                  title={composeAccessibleName([option.name, option.email])}
                  onClick={() => {
                    const participant: EditorParticipant = {
                      userId: option.userId,
                      name: option.name,
                      email: option.email ?? undefined,
                      isCustomer: option.isCustomer,
                    }
                    onChange(mode === 'single' ? [participant] : [...value, participant])
                    setQuery('')
                    if (mode === 'single') setOpen(false)
                  }}
                  className="h-auto w-full justify-start gap-2 whitespace-normal px-2 py-1.5 text-left text-sm font-normal text-foreground"
                >
                  <Avatar size="xs" label={option.name} />
                  <span className="min-w-0 flex-1 truncate">
                    {option.name}
                    {option.email ? <span className="ml-1.5 text-xs text-muted-foreground">{option.email}</span> : null}
                  </span>
                  {option.isCustomer ? customerBadge : null}
                </Button>
              ))
            : null}
        </div>
      ) : null}
    </div>
  )
}
