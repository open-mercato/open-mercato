"use client"

import * as React from 'react'
import { Loader2, Linkedin, Pencil, Twitter, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { Button } from '@open-mercato/ui/primitives/button'
import type { PluggableList } from 'unified'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@/lib/i18n/context'
import { cn } from '@/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import remarkGfm from 'remark-gfm'
import {
  InlineMultilineEditor as UiInlineMultilineEditor,
  InlineTextEditor as UiInlineTextEditor,
  type InlineFieldType as UiInlineFieldType,
  type InlineMultilineEditorProps,
  type InlineTextEditorProps,
  InlineSelectEditor as UiInlineSelectEditor,
  type InlineSelectOption,
} from '@open-mercato/ui/backend/detail/InlineEditors'
import {
  DictionaryValue,
  ICON_SUGGESTIONS,
  renderDictionaryColor,
  renderDictionaryIcon,
  type CustomerDictionaryKind,
} from '../../lib/dictionaries'
import { DictionarySelectField } from '../formConfig'
import { AppearanceSelector } from '@open-mercato/core/modules/dictionaries/components/AppearanceSelector'
import { createDictionarySelectLabels, formatDateTime } from './utils'
import {
  invalidateCustomerDictionary,
  useCustomerDictionary,
} from './hooks/useCustomerDictionary'

export type InlineFieldType = UiInlineFieldType
export type InlineFieldProps = InlineTextEditorProps
export type InlineMultilineDisplayRenderer = NonNullable<InlineMultilineEditorProps['renderDisplay']>

export const InlineTextEditor = UiInlineTextEditor
export const InlineMultilineEditor = UiInlineMultilineEditor
export const InlineSelectEditor = UiInlineSelectEditor

const MARKDOWN_PREVIEW_PLUGINS: PluggableList = [remarkGfm]

function createSocialRenderDisplay(IconComponent: typeof Linkedin): NonNullable<InlineFieldProps['renderDisplay']> {
  // eslint-disable-next-line react/display-name
  return ({ value, emptyLabel }) => {
    const raw = typeof value === 'string' ? value.trim() : ''
    if (!raw.length) {
      return <span className="text-sm text-muted-foreground">{emptyLabel}</span>
    }
    const display = raw.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')
    return (
      <a
        className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary/90 hover:underline"
        href={raw}
        target="_blank"
        rel="noreferrer"
      >
        <IconComponent aria-hidden className="h-4 w-4" />
        <span className="truncate">{display}</span>
      </a>
    )
  }
}

export const renderLinkedInDisplay = createSocialRenderDisplay(Linkedin)
export const renderTwitterDisplay = createSocialRenderDisplay(Twitter)

export const renderMultilineMarkdownDisplay: InlineMultilineDisplayRenderer = ({ value, emptyLabel }) => {
  const raw = typeof value === 'string' ? value : ''
  const trimmed = raw.trim()
  if (!trimmed.length) {
    return <span className="text-muted-foreground">{emptyLabel}</span>
  }
  return (
    <ReactMarkdown
      remarkPlugins={MARKDOWN_PREVIEW_PLUGINS}
      className="text-sm text-foreground [&>*]:mb-2 [&>*:last-child]:mb-0 [&_ul]:ml-4 [&_ul]:list-disc [&_ol]:ml-4 [&_ol]:list-decimal [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-xs"
    >
      {raw}
    </ReactMarkdown>
  )
}

type DictionaryEditorProps = {
  label: string
  value: string | null | undefined
  emptyLabel: string
  onSave: (value: string | null) => Promise<void>
  kind: CustomerDictionaryKind
  variant?: 'default' | 'muted'
  activateOnClick?: boolean
  containerClassName?: string
  triggerClassName?: string
  selectClassName?: string
}

export function InlineDictionaryEditor({
  label,
  value,
  emptyLabel,
  onSave,
  kind,
  variant = 'default',
  activateOnClick = false,
  containerClassName,
  triggerClassName,
  selectClassName,
}: DictionaryEditorProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const translate = React.useCallback(
    (key: string, fallback: string) => {
      const result = t(key)
      return result === key ? fallback : result
    },
    [t],
  )
  const dictionaryLabels = React.useMemo(() => createDictionarySelectLabels(kind, translate), [kind, translate])
  const scopeVersion = useOrganizationScopeVersion()
  const dictionaryQuery = useCustomerDictionary(kind, scopeVersion)
  const dictionaryMap = dictionaryQuery.data?.map ?? null
  const selectOptions = React.useMemo<InlineSelectOption[]>(() => {
    if (!dictionaryMap) return []
    return Object.values(dictionaryMap).map((entry) => ({ value: entry.value, label: entry.label }))
  }, [dictionaryMap])

  const handleSave = React.useCallback(
    async (nextValue: string | null) => {
      try {
        await onSave(nextValue)
        await invalidateCustomerDictionary(queryClient, kind)
      } catch (err) {
        const message = err instanceof Error ? err.message : t('customers.people.detail.inline.error')
        flash(message, 'error')
      }
    },
    [kind, onSave, queryClient, t],
  )

  return (
    <UiInlineSelectEditor
      label={label}
      value={value}
      emptyLabel={emptyLabel}
      options={selectOptions}
      onSave={handleSave}
      variant={variant}
      activateOnClick={activateOnClick}
      containerClassName={containerClassName}
      triggerClassName={triggerClassName}
      hideLabel={false}
      renderEditor={({ value: selectValue, onChange }) => (
        <>
          <DictionarySelectField
            kind={kind}
            value={selectValue.length ? selectValue : undefined}
            onChange={onChange}
            labels={dictionaryLabels}
            selectClassName={selectClassName}
          />
          {dictionaryQuery.isError ? (
            <p className="text-xs text-red-600">
              {dictionaryQuery.error instanceof Error
                ? dictionaryQuery.error.message
                : translate('customers.people.form.dictionary.errorLoad', 'Failed to load options')}
            </p>
          ) : null}
        </>
      )}
      renderDisplay={({ value: currentValue }) => {
        if (dictionaryMap) {
          return (
            <DictionaryValue
              value={currentValue}
              map={dictionaryMap}
              fallback={<span className="text-sm text-muted-foreground">{emptyLabel}</span>}
              className="text-sm"
              iconWrapperClassName="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-card"
              iconClassName="h-4 w-4"
              colorClassName="h-3 w-3 rounded-full"
            />
          )
        }
        if (currentValue && currentValue.length) {
          return <span className="break-words text-sm">{currentValue}</span>
        }
        if (dictionaryQuery.isLoading) {
          return (
            <span className="text-sm text-muted-foreground">
              {translate('customers.people.form.dictionary.loading', 'Loading…')}
            </span>
          )
        }
        return <span className="text-sm text-muted-foreground">{emptyLabel}</span>
      }}
    />
  )
}

export type NextInteractionPayload = {
  at: string
  name: string
  refId?: string | null
  icon?: string | null
  color?: string | null
}

type NextInteractionEditorProps = {
  label: string
  valueAt: string | null | undefined
  valueName: string | null | undefined
  valueRefId: string | null | undefined
  valueIcon: string | null | undefined
  valueColor: string | null | undefined
  emptyLabel: string
  onSave: (next: NextInteractionPayload | null) => Promise<void>
  activateOnClick?: boolean
}

export function InlineNextInteractionEditor({
  label,
  valueAt,
  valueName,
  valueRefId,
  valueIcon,
  valueColor,
  emptyLabel,
  onSave,
  activateOnClick = false,
}: NextInteractionEditorProps) {
  const t = useT()
  const [editing, setEditing] = React.useState(false)
  const [draftDate, setDraftDate] = React.useState<string>(() => (valueAt ? valueAt.slice(0, 16) : ''))
  const [draftName, setDraftName] = React.useState(valueName ?? '')
  const [draftRefId, setDraftRefId] = React.useState(valueRefId ?? '')
  const [draftIcon, setDraftIcon] = React.useState(valueIcon ?? '')
  const [draftColor, setDraftColor] = React.useState<string | null>(valueColor ?? null)
  const [dateError, setDateError] = React.useState<string | null>(null)
  const [nameError, setNameError] = React.useState<string | null>(null)
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const formRef = React.useRef<HTMLFormElement | null>(null)
  const dateErrorId = React.useId()
  const nameErrorId = React.useId()
  const containerClasses = cn('group relative rounded-lg border p-4', activateOnClick && !editing ? 'cursor-pointer' : null)
  const requiredMessage = React.useMemo(
    () => t('customers.people.detail.inline.required', 'This field is required'),
    [t],
  )

  React.useEffect(() => {
    if (!editing) {
      setDraftDate(valueAt ? valueAt.slice(0, 16) : '')
      setDraftName(valueName ?? '')
      setDraftRefId(valueRefId ?? '')
      setDraftIcon(valueIcon ?? '')
      setDraftColor(valueColor ?? null)
      setDateError(null)
      setNameError(null)
      setSubmitError(null)
    }
  }, [editing, valueAt, valueName, valueRefId, valueIcon, valueColor])

  const appearanceLabels = React.useMemo(
    () => ({
      colorLabel: t('customers.people.detail.inline.nextInteractionColorLabel'),
      colorHelp: t('customers.people.detail.inline.nextInteractionColorHelp'),
      colorClearLabel: t('customers.people.detail.inline.nextInteractionColorClear'),
      iconLabel: t('customers.people.detail.inline.nextInteractionIconLabel'),
      iconPlaceholder: t('customers.people.detail.inline.nextInteractionIconPlaceholder'),
      iconPickerTriggerLabel: t('customers.people.detail.inline.nextInteractionIconBrowse'),
      iconSearchPlaceholder: t('customers.people.detail.inline.nextInteractionIconSearchPlaceholder'),
      iconSearchEmptyLabel: t('customers.people.detail.inline.nextInteractionIconSearchEmpty'),
      iconSuggestionsLabel: t('customers.people.detail.inline.nextInteractionIconSuggestions'),
      iconClearLabel: t('customers.people.detail.inline.nextInteractionIconClear'),
      previewEmptyLabel: t('customers.people.detail.inline.nextInteractionAppearanceEmpty'),
    }),
    [t],
  )

  const handleSave = React.useCallback(async () => {
    setSubmitError(null)
    setDateError(null)
    setNameError(null)
    const trimmedName = draftName.trim()
    let hasError = false
    if (!draftDate) {
      setDateError(requiredMessage)
      hasError = true
    }
    if (!trimmedName.length) {
      setNameError(requiredMessage)
      hasError = true
    }
    if (hasError) return
    const parsedDate = new Date(draftDate)
    if (Number.isNaN(parsedDate.getTime())) {
      setDateError(t('customers.people.detail.inline.nextInteractionInvalid'))
      return
    }
    const iso = parsedDate.toISOString()
    const trimmedRef = draftRefId.trim()
    const trimmedIcon = draftIcon.trim()
    const normalizedColor = (() => {
      if (!draftColor) return null
      const trimmed = draftColor.trim().toLowerCase()
      return /^#([0-9a-f]{6})$/.test(trimmed) ? trimmed : null
    })()
    setSaving(true)
    try {
      await onSave({
        at: iso,
        name: trimmedName,
        refId: trimmedRef.length ? trimmedRef : null,
        icon: trimmedIcon.length ? trimmedIcon : null,
        color: normalizedColor,
      })
      setEditing(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customers.people.detail.inline.error')
      setSubmitError(message)
    } finally {
      setSaving(false)
    }
  }, [draftColor, draftDate, draftIcon, draftName, draftRefId, onSave, requiredMessage, t])

  const handleFormSubmit = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (saving) return
      void handleSave()
    },
    [handleSave, saving],
  )

  const handleFormKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLFormElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setEditing(false)
        return
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        if (saving) return
        try {
          formRef.current?.requestSubmit()
        } catch {
          void handleSave()
        }
      }
    },
    [handleSave, saving],
  )

  const handleActivate = React.useCallback(() => {
    if (!editing) setEditing(true)
  }, [editing])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!activateOnClick || editing) return
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        handleActivate()
      }
    },
    [activateOnClick, editing, handleActivate],
  )

  const handleInteractiveClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!activateOnClick || editing) return
      const target = event.target as HTMLElement
      const interactiveElement = target.closest('button, input, select, textarea, a, [role=\"link\"]')
      if (interactiveElement) {
        if (interactiveElement.tagName.toLowerCase() === 'a') {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            return
          }
          event.preventDefault()
        } else {
          return
        }
      }
      handleActivate()
    },
    [activateOnClick, editing, handleActivate],
  )

  const interactiveProps: React.HTMLAttributes<HTMLDivElement> =
    activateOnClick && !editing
      ? {
          role: 'button' as const,
          tabIndex: 0,
          onClick: handleInteractiveClick,
          onKeyDown: handleKeyDown,
        }
      : {}

  return (
    <div className={containerClasses} onClick={handleInteractiveClick}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn(
          'absolute right-3 top-3 transition-opacity duration-150',
          editing
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
        )}
        onClick={(event) => {
          event.stopPropagation()
          setEditing((state) => !state)
        }}
      >
        {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
      </Button>
      <div className="flex items-start gap-2" {...interactiveProps}>
        <div className="flex-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          {editing ? (
            <form
              ref={formRef}
              className="mt-2 space-y-4"
              onSubmit={handleFormSubmit}
              onKeyDown={handleFormKeyDown}
            >
              <input
                type="datetime-local"
                className={cn(
                  'w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring',
                  dateError ? 'border-destructive focus:border-destructive focus:ring-destructive/40' : null,
                )}
                value={draftDate}
                aria-invalid={dateError ? 'true' : undefined}
                aria-required="true"
                aria-describedby={dateError ? dateErrorId : undefined}
                onChange={(event) => {
                  if (dateError) setDateError(null)
                  if (submitError) setSubmitError(null)
                  setDraftDate(event.target.value)
                }}
              />
              {dateError ? (
                <p id={dateErrorId} className="text-xs text-destructive">
                  {dateError}
                </p>
              ) : null}
              <input
                placeholder={t('customers.people.detail.inline.nextInteractionName')}
                className={cn(
                  'w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring',
                  nameError ? 'border-destructive focus:border-destructive focus:ring-destructive/40' : null,
                )}
                value={draftName}
                aria-invalid={nameError ? 'true' : undefined}
                aria-required="true"
                aria-describedby={nameError ? nameErrorId : undefined}
                onChange={(event) => {
                  if (submitError) setSubmitError(null)
                  if (nameError) setNameError(null)
                  setDraftName(event.target.value)
                }}
              />
              {nameError ? (
                <p id={nameErrorId} className="text-xs text-destructive">
                  {nameError}
                </p>
              ) : null}
              <input
                placeholder={t('customers.people.detail.inline.nextInteractionRef')}
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={draftRefId}
                onChange={(event) => {
                  if (submitError) setSubmitError(null)
                  setDraftRefId(event.target.value)
                }}
              />
              <AppearanceSelector
                icon={draftIcon || null}
                color={draftColor}
                onIconChange={(next) => {
                  if (submitError) setSubmitError(null)
                  setDraftIcon(next ?? '')
                }}
                onColorChange={(next) => {
                  if (submitError) setSubmitError(null)
                  setDraftColor(next)
                }}
                iconSuggestions={ICON_SUGGESTIONS}
                disabled={saving}
                labels={appearanceLabels}
              />
              {submitError && !dateError && !nameError ? (
                <p className="text-xs text-destructive">{submitError}</p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" size="sm" disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                  {t('customers.people.detail.inline.saveShortcut', 'Save ⌘⏎ / Ctrl+Enter')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                  {t('customers.people.detail.inline.cancel')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    setDraftDate('')
                    setDraftName('')
                    setDraftRefId('')
                    setDraftIcon('')
                    setDraftColor(null)
                    setDateError(null)
                    setNameError(null)
                    setSubmitError(null)
                    setSaving(true)
                    try {
                      await onSave(null)
                      setEditing(false)
                    } catch (err) {
                      const message = err instanceof Error ? err.message : t('customers.people.detail.inline.error')
                      setSubmitError(message)
                    } finally {
                      setSaving(false)
                    }
                  }}
                  disabled={saving}
                >
                  {t('customers.people.detail.inline.clear')}
                </Button>
              </div>
            </form>
          ) : (
            <div className="mt-1 text-sm">
              {valueAt ? (
                <div className="flex items-start gap-3">
                  {valueIcon ? (
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded border border-border bg-card">
                      {renderDictionaryIcon(valueIcon, 'h-4 w-4')}
                    </span>
                  ) : null}
                  <div className="flex-1">
                    <span className="block">{formatDateTime(valueAt)}</span>
                    {valueName ? <span className="text-xs text-muted-foreground">{valueName}</span> : null}
                    {valueRefId ? <span className="text-xs text-muted-foreground">#{valueRefId}</span> : null}
                  </div>
                  {valueColor ? renderDictionaryColor(valueColor, 'h-3 w-3 rounded-full border border-border') : null}
                </div>
              ) : (
                <span className="text-muted-foreground">{emptyLabel}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
