'use client'

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Tag } from '@open-mercato/ui/primitives/tag'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { evaluateFormLogic, type LogicState, type JumpTarget } from '../services/form-logic-evaluator'
import { partitionPages } from '../services/form-version-compiler'

export type FormRunnerProps = {
  formId: string
  formVersionId: string
  schema: Record<string, unknown>
  uiSchema: Record<string, unknown>
  hidden: Record<string, unknown>
  locale: string
  /** Optional URL to POST submissions to (defaults to /api/forms/:id/run/submissions). */
  submitEndpoint?: string
}

export function FormRunner({
  formId,
  formVersionId,
  schema,
  hidden,
  locale,
  submitEndpoint,
}: FormRunnerProps) {
  const t = useT()
  const sections = React.useMemo(() => readSections(schema), [schema])
  const pages = React.useMemo(() => partitionPages(sections), [sections])
  const [answers, setAnswers] = React.useState<Record<string, unknown>>({})
  const [pageIndex, setPageIndex] = React.useState(0)
  const [endingKey, setEndingKey] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const [submitted, setSubmitted] = React.useState(false)

  const state: LogicState = React.useMemo(
    () => evaluateFormLogic(schema, { answers, hidden, locale }),
    [schema, answers, hidden, locale],
  )

  const currentPage = pages[pageIndex]
  const isLastPage = pageIndex >= pages.length - 1
  const isFirstPage = pageIndex === 0

  const handleAnswerChange = React.useCallback((fieldKey: string, value: unknown) => {
    setAnswers((current) => ({ ...current, [fieldKey]: value }))
  }, [])

  const handleNext = React.useCallback(async () => {
    if (!currentPage) return
    const currentPageKey = currentPage.sectionKeys.find((key) => sections.find((s) => s.key === key && (s.kind === 'page' || s.kind === undefined))) ?? currentPage.sectionKeys[0]
    if (!currentPageKey) return
    const target: JumpTarget = state.nextTarget(currentPageKey)
    if (target.type === 'ending') {
      setEndingKey(target.endingKey)
      await submitToServer(target.endingKey)
      return
    }
    if (target.type === 'submit') {
      await submitToServer(null)
      return
    }
    if (target.type === 'page') {
      const idx = pages.findIndex((page) => page.sectionKeys.includes(target.pageKey))
      if (idx >= 0) {
        setPageIndex(idx)
        return
      }
    }
    if (isLastPage) {
      await submitToServer(null)
      return
    }
    setPageIndex((current) => Math.min(pages.length - 1, current + 1))
  }, [currentPage, isLastPage, pages, sections, state])

  const submitToServer = async (claimedEndingKey: string | null) => {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const endpoint = submitEndpoint ?? `/api/forms/${encodeURIComponent(formId)}/run/submissions`
      await apiCall(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          formVersionId,
          answers,
          hidden,
          endingKey: claimedEndingKey,
          locale,
        }),
        headers: { 'content-type': 'application/json' },
      })
      setSubmitted(true)
      if (claimedEndingKey) {
        const endingSection = sections.find((entry) => entry.key === claimedEndingKey && entry.kind === 'ending')
        const redirectUrl = endingSection?.['x-om-redirect-url']
        if (typeof redirectUrl === 'string' && redirectUrl.length > 0 && typeof window !== 'undefined') {
          window.location.assign(redirectUrl)
        }
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t('forms.runner.submit.error'))
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted && endingKey) {
    const endingSection = sections.find((entry) => entry.key === endingKey && entry.kind === 'ending')
    if (endingSection) {
      const title = state.resolveRecall(endingSection.title as Record<string, string>, locale)
      return (
        <article className="rounded-lg border border-border bg-card p-6 space-y-3">
          <Tag variant="success">{t('forms.runner.actions.submit')}</Tag>
          <h2 className="text-lg font-semibold text-foreground">{title || endingSection.key}</h2>
          {endingSection.fieldKeys.map((fieldKey) => {
            const node = (schema.properties as Record<string, Record<string, unknown>>)?.[fieldKey]
            if (!node) return null
            const label = state.resolveRecall(node['x-om-label'] as Record<string, string>, locale)
            const help = state.resolveRecall(node['x-om-help'] as Record<string, string>, locale)
            return (
              <div key={fieldKey} className="rounded-md border border-border bg-muted/30 p-3">
                {label ? <p className="text-sm font-medium text-foreground">{label}</p> : null}
                {help ? <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{help}</p> : null}
              </div>
            )
          })}
        </article>
      )
    }
  }

  if (submitted) {
    return (
      <article className="rounded-lg border border-border bg-card p-6 space-y-3">
        <Tag variant="success">{t('forms.runner.completion.title')}</Tag>
        <p className="text-sm text-muted-foreground">{t('forms.runner.completion.subtitle')}</p>
      </article>
    )
  }

  const visibleSections = currentPage
    ? currentPage.sectionKeys
        .map((key) => sections.find((entry) => entry.key === key))
        .filter((entry): entry is RunnerSection => Boolean(entry))
        .filter((entry) => state.visibleSectionKeys.has(entry.key) && entry.kind !== 'ending')
    : []

  return (
    <div className="space-y-4">
      {submitError ? <Alert variant="destructive">{submitError}</Alert> : null}
      {visibleSections.map((section) => {
        const title = state.resolveRecall(section.title as Record<string, string>, locale)
        return (
          <section key={section.key} className="rounded-lg border border-border bg-card p-4 space-y-2">
            {!section.hideTitle && title ? (
              <h2 className="text-base font-semibold text-foreground">{title}</h2>
            ) : null}
            <div className="space-y-3">
              {section.fieldKeys.map((fieldKey) => {
                if (!state.visibleFieldKeys.has(fieldKey)) return null
                return (
                  <FieldRunnerRow
                    key={fieldKey}
                    fieldKey={fieldKey}
                    node={(schema.properties as Record<string, Record<string, unknown>>)?.[fieldKey] ?? {}}
                    value={answers[fieldKey]}
                    onChange={(value) => handleAnswerChange(fieldKey, value)}
                    state={state}
                    locale={locale}
                    required={Array.isArray(schema.required) && (schema.required as string[]).includes(fieldKey)}
                  />
                )
              })}
            </div>
          </section>
        )
      })}
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          disabled={isFirstPage}
          onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
        >
          {t('forms.runner.actions.back')}
        </Button>
        <Button type="button" onClick={handleNext} disabled={submitting}>
          {isLastPage ? t('forms.runner.actions.submit') : t('forms.runner.actions.next')}
        </Button>
      </div>
    </div>
  )
}

type RunnerSection = {
  key: string
  kind?: 'page' | 'section' | 'ending'
  title?: Record<string, string>
  fieldKeys: string[]
  hideTitle?: boolean
  'x-om-redirect-url'?: string | null
}

function readSections(schema: Record<string, unknown>): RunnerSection[] {
  const raw = schema['x-om-sections']
  if (!Array.isArray(raw)) return []
  const result: RunnerSection[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Record<string, unknown>
    if (typeof candidate.key !== 'string') continue
    result.push({
      key: candidate.key,
      kind: candidate.kind as RunnerSection['kind'],
      title: candidate.title as Record<string, string>,
      fieldKeys: Array.isArray(candidate.fieldKeys) ? (candidate.fieldKeys as string[]) : [],
      hideTitle: candidate.hideTitle === true,
      'x-om-redirect-url': typeof candidate['x-om-redirect-url'] === 'string' ? (candidate['x-om-redirect-url'] as string) : null,
    })
  }
  return result
}

type FieldRunnerRowProps = {
  fieldKey: string
  node: Record<string, unknown>
  value: unknown
  onChange: (value: unknown) => void
  state: LogicState
  locale: string
  required: boolean
}

function FieldRunnerRow({ fieldKey, node, value, onChange, state, locale, required }: FieldRunnerRowProps) {
  const omType = String(node['x-om-type'] ?? 'text')
  const label = state.resolveRecall(node['x-om-label'] as Record<string, string>, locale) || fieldKey
  const help = state.resolveRecall(node['x-om-help'] as Record<string, string>, locale)
  if (omType === 'info_block') {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-3">
        {label ? <p className="text-sm font-medium text-foreground">{label}</p> : null}
        {help ? <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{help}</p> : null}
      </div>
    )
  }
  const stringValue = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)
  const options = Array.isArray(node['x-om-options']) ? (node['x-om-options'] as Array<{ value: string; label?: Record<string, string> }>) : []
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-foreground" htmlFor={`runner-${fieldKey}`}>
        {label}
        {required ? <span className="ml-1 text-status-error-text" aria-hidden="true">*</span> : null}
      </label>
      {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
      {(() => {
        switch (omType) {
          case 'textarea':
            return <Textarea id={`runner-${fieldKey}`} rows={3} value={stringValue} onChange={(event) => onChange(event.target.value)} />
          case 'number':
            return (
              <Input
                id={`runner-${fieldKey}`}
                type="number"
                step="any"
                value={stringValue}
                onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
              />
            )
          case 'integer':
            return (
              <Input
                id={`runner-${fieldKey}`}
                type="number"
                step={1}
                value={stringValue}
                onChange={(event) => onChange(event.target.value === '' ? '' : Math.trunc(Number(event.target.value)))}
              />
            )
          case 'boolean':
            return (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={value === true} onCheckedChange={(next) => onChange(Boolean(next))} aria-label={label} />
                <span>{label}</span>
              </label>
            )
          case 'yes_no':
            return (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">No</span>
                <Switch checked={value === true} onCheckedChange={(next) => onChange(Boolean(next))} aria-label={label} />
                <span className="text-muted-foreground">Yes</span>
              </div>
            )
          case 'date':
            return <Input id={`runner-${fieldKey}`} type="date" value={stringValue} onChange={(event) => onChange(event.target.value)} />
          case 'datetime':
            return <Input id={`runner-${fieldKey}`} type="datetime-local" value={stringValue} onChange={(event) => onChange(event.target.value)} />
          case 'select_one':
            return (
              <Select value={typeof value === 'string' ? value : undefined} onValueChange={(next) => onChange(next)}>
                <SelectTrigger id={`runner-${fieldKey}`}>
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label?.[locale] ?? option.label?.en ?? option.value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
          default:
            return <Input id={`runner-${fieldKey}`} type="text" value={stringValue} onChange={(event) => onChange(event.target.value)} />
        }
      })()}
    </div>
  )
}
