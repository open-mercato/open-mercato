"use client"

import * as React from 'react'
import { Building2, ChevronDown, User, X } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import type { EditorRelatedTo } from '../../../lib/calendar/editorPayload'
import { composeAccessibleName } from '../../../lib/calendar/labels'
import {
  fetchDealsForEntity,
  searchRelatedEntities,
  type DealOption,
  type RelatedEntityOption,
} from './lookups'
import { CONTROL_BORDER, DROPDOWN_PANEL_CLASS, PersonChip, UppercaseBadge, useDropdownDismiss } from './inputs'

const OPTION_ROW_CLASS =
  'h-auto w-full justify-start gap-2 whitespace-normal px-2 py-1.5 text-left text-sm font-normal text-foreground'

export function RelatedToField({
  label,
  value,
  deal,
  onChange,
  onDealChange,
  error,
}: {
  label: string
  value: EditorRelatedTo | null
  deal: DealOption | null
  onChange(next: EditorRelatedTo | null): void
  onDealChange(next: DealOption | null): void
  error?: string | null
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const closeDropdown = React.useCallback(() => setOpen(false), [])
  const rootRef = useDropdownDismiss(open, closeDropdown)
  const [query, setQuery] = React.useState('')
  const [options, setOptions] = React.useState<RelatedEntityOption[]>([])
  const [deals, setDeals] = React.useState<DealOption[]>([])
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const trimmed = query.trim()
        const [people, companies] = await Promise.all([
          searchRelatedEntities('person', trimmed, controller.signal),
          searchRelatedEntities('company', trimmed, controller.signal),
        ])
        if (cancelled) return
        setOptions([...people, ...companies])
      } catch {
        if (!cancelled) setOptions([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 200)
    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [open, query])

  React.useEffect(() => {
    if (!open || !value || value.kind === 'unknown') {
      setDeals([])
      return
    }
    const controller = new AbortController()
    let cancelled = false
    fetchDealsForEntity({ id: value.id, kind: value.kind }, controller.signal)
      .then((items) => { if (!cancelled) setDeals(items) })
      .catch(() => { if (!cancelled) setDeals([]) })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [open, value])

  const kindLabel = (kind: RelatedEntityOption['kind']) =>
    kind === 'person'
      ? t('customers.deals.detail.tabs.peopleSingular', 'Person')
      : t('customers.deals.detail.tabs.companySingular', 'Company')

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
          'flex h-10 w-full items-center rounded-md bg-background pl-2.5 pr-3 transition-colors hover:bg-accent/50',
          error ? 'border border-status-error-border' : CONTROL_BORDER,
        )}
      >
        <Button
          type="button"
          variant="ghost"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={label}
          onClick={() => setOpen((previous) => !previous)}
          className="h-full min-w-0 flex-1 justify-between rounded-none bg-transparent p-0 text-left shadow-none hover:bg-transparent dark:hover:bg-transparent"
        >
          <span className="flex min-w-0 items-center gap-2">
            {value ? (
              <PersonChip
                compact
                name={value.label || value.id}
              />
            ) : (
              <span className="truncate text-sm text-muted-foreground">
                {t('customers.calendar.editor.relatedToPlaceholder', 'Search people or companies…')}
              </span>
            )}
          </span>
          <span className="flex shrink-0 items-center">
            {deal ? (
              <UppercaseBadge className="h-7 bg-status-info-bg text-status-info-text">
                {t('customers.calendar.editor.dealBadge', '{name} · Deal', { name: deal.label })}
              </UppercaseBadge>
            ) : null}
            <span aria-hidden className="h-px w-2" />
            <ChevronDown aria-hidden className="size-4 opacity-60" />
          </span>
        </Button>
        {value ? (
          <IconButton
            variant="ghost"
            size="xs"
            onClick={() => {
              onChange(null)
              onDealChange(null)
            }}
            aria-label={t('customers.calendar.editor.removeRelated', 'Clear related record')}
            className="ms-1 shrink-0 text-muted-foreground"
          >
            <X aria-hidden className="size-3.5" />
          </IconButton>
        ) : null}
      </div>
      {open ? (
        <div role="listbox" aria-label={label} className={DROPDOWN_PANEL_CLASS}>
          <Input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('customers.calendar.editor.relatedToPlaceholder', 'Search people or companies…')}
            aria-label={t('customers.calendar.editor.relatedToPlaceholder', 'Search people or companies…')}
            autoFocus
            size="sm"
            className="mb-1"
          />
          {loading ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              {t('customers.calendar.editor.searching', 'Searching…')}
            </p>
          ) : null}
          {!loading && options.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              {t('customers.calendar.editor.noResults', 'No results')}
            </p>
          ) : null}
          {!loading
            ? options.map((option) => (
                <Button
                  key={`${option.kind}:${option.id}`}
                  type="button"
                  variant="ghost"
                  role="option"
                  aria-selected={value?.id === option.id}
                  aria-label={composeAccessibleName([option.label, option.subtitle, kindLabel(option.kind)])}
                  title={composeAccessibleName([option.label, option.subtitle])}
                  onClick={() => {
                    onChange({ id: option.id, kind: option.kind, label: option.label })
                    if (value?.id !== option.id) onDealChange(null)
                    setQuery('')
                  }}
                  className={OPTION_ROW_CLASS}
                >
                  {option.kind === 'company'
                    ? <Building2 aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                    : <User aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />}
                  <span className="min-w-0 flex-1 truncate">
                    {option.label}
                    {option.subtitle ? <span className="ml-1.5 text-xs text-muted-foreground">{option.subtitle}</span> : null}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{kindLabel(option.kind)}</span>
                </Button>
              ))
            : null}
          {value && deals.length > 0 ? (
            <>
              <p className="px-2 pb-1 pt-2 text-overline font-medium uppercase text-muted-foreground">
                {t('customers.calendar.editor.dealsSection', 'Deals')}
              </p>
              <Button
                type="button"
                variant="ghost"
                role="option"
                aria-selected={deal === null}
                onClick={() => {
                  onDealChange(null)
                  setOpen(false)
                }}
                className={OPTION_ROW_CLASS}
              >
                {t('customers.calendar.editor.dealNone', 'No deal')}
              </Button>
              {deals.map((option) => (
                <Button
                  key={option.id}
                  type="button"
                  variant="ghost"
                  role="option"
                  aria-selected={deal?.id === option.id}
                  title={option.label}
                  onClick={() => {
                    onDealChange(option)
                    setOpen(false)
                  }}
                  className={OPTION_ROW_CLASS}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  <UppercaseBadge className="bg-status-info-bg text-status-info-text">
                    {t('customers.calendar.editor.dealBadgeSuffix', 'Deal')}
                  </UppercaseBadge>
                </Button>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
