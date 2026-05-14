'use client'

import * as React from 'react'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Input } from '@open-mercato/ui/primitives/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Separator } from '@open-mercato/ui/primitives/separator'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import {
  partitionPages,
  resolveFormLabelPosition,
  resolveFormStyle,
  resolvePageMode,
  resolveSectionViews,
  resolveShowProgress,
  type ResolvedSectionView,
} from '../../../../../services/form-version-compiler'
import { evaluateFormLogic, type LogicState } from '../../../../../services/form-logic-evaluator'
import type { FieldNode, FormSchema } from '../schema-helpers'
import type { PreviewViewport } from './ViewportFrame'

/**
 * Phase E — Preview surface.
 *
 * Renders sections + fields read-only with role-aware visibility, viewport-
 * aware grid collapse (Decision 3b), density / label position (Decisions
 * 20a/20b), and paginated navigation (Decision 11a).
 *
 * Mode is implicit `'preview'` — drag handles, trash buttons, inline-edit
 * affordances, and `Add Field` are all gone.
 */

export type PreviewSurfaceProps = {
  schema: FormSchema
  viewport: PreviewViewport
  previewRole: string
  t: TranslateFn
}

type FieldOption = { value: string; label?: { [locale: string]: string } }

const SPACE_BY_DENSITY: Record<'default' | 'compact' | 'spacious', string> = {
  default: 'space-y-4',
  compact: 'space-y-2',
  spacious: 'space-y-6',
}

const GAP_BY_DENSITY: Record<'default' | 'compact' | 'spacious', string> = {
  default: 'gap-4',
  compact: 'gap-2',
  spacious: 'gap-6',
}

const COLUMNS_TO_GRID_CLASS: Record<1 | 2 | 3 | 4, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
}

const SPAN_TO_CLASS: Record<1 | 2 | 3 | 4, string> = {
  1: 'col-span-1',
  2: 'col-span-2',
  3: 'col-span-3',
  4: 'col-span-4',
}

const ALIGN_TO_CLASS: Record<'start' | 'center' | 'end', string> = {
  start: 'text-left',
  center: 'text-center',
  end: 'text-right',
}

function readPersistedSpan(value: unknown): 1 | 2 | 3 | 4 {
  if (value === 2 || value === 3 || value === 4) return value
  return 1
}

function readAlign(value: unknown): 'start' | 'center' | 'end' {
  return value === 'center' || value === 'end' ? value : 'start'
}

/**
 * Effective render columns — Decision 3b. Mobile collapses to 1, tablet
 * collapses to `min(2, columns)`, desktop preserves the persisted value.
 */
function effectiveColumns(
  persisted: 1 | 2 | 3 | 4,
  viewport: PreviewViewport,
): 1 | 2 | 3 | 4 {
  if (viewport === 'mobile') return 1
  if (viewport === 'tablet') return persisted >= 2 ? 2 : persisted
  return persisted
}

function effectiveSpan(persisted: 1 | 2 | 3 | 4, columns: 1 | 2 | 3 | 4): 1 | 2 | 3 | 4 {
  return persisted <= columns ? persisted : columns
}

export function PreviewSurface({
  schema,
  viewport,
  previewRole,
  t,
}: PreviewSurfaceProps) {
  const sections = React.useMemo<ResolvedSectionView[]>(
    () => resolveSectionViews(schema as Record<string, unknown>),
    [schema],
  )
  const pages = React.useMemo(() => partitionPages(sections), [sections])
  const pageMode = resolvePageMode(schema as Record<string, unknown>)
  const [answers, setAnswers] = React.useState<Record<string, unknown>>({})
  const logicState: LogicState = React.useMemo(
    () => evaluateFormLogic(schema as Record<string, unknown>, {
      answers,
      hidden: {},
      locale: 'en',
    }),
    [schema, answers],
  )
  const handleAnswerChange = React.useCallback((fieldKey: string, value: unknown) => {
    setAnswers((current) => ({ ...current, [fieldKey]: value }))
  }, [])
  const isPaginated = pageMode === 'paginated' && pages.length >= 1
  const density = resolveFormStyle(schema as Record<string, unknown>)
  const persistedLabelPosition = resolveFormLabelPosition(schema as Record<string, unknown>)
  // Decision 20b — mobile collapses 'left' → 'top'.
  const labelPosition: 'top' | 'left' =
    viewport === 'mobile' ? 'top' : persistedLabelPosition
  const showProgress = resolveShowProgress(schema as Record<string, unknown>)
  const progressActive = isPaginated && pages.length >= 2 && showProgress

  const [activePageIndex, setActivePageIndex] = React.useState(0)
  React.useEffect(() => {
    if (!isPaginated) return
    if (activePageIndex >= pages.length) {
      setActivePageIndex(Math.max(0, pages.length - 1))
    }
  }, [pages.length, isPaginated, activePageIndex])

  const sectionsByKey = React.useMemo(() => {
    const map = new Map<string, ResolvedSectionView>()
    for (const section of sections) map.set(section.key, section)
    return map
  }, [sections])

  const renderSection = (section: ResolvedSectionView, pageIndex: number | null) => {
    const columns = effectiveColumns(section.columns, viewport)
    return (
      <SectionPreview
        key={section.key}
        section={section}
        schema={schema}
        previewRole={previewRole}
        viewport={viewport}
        density={density}
        labelPosition={labelPosition}
        renderColumns={columns}
        pageIndex={pageIndex}
        showPageChip={pages.length > 1 && !isPaginated}
        logicState={logicState}
        onAnswerChange={handleAnswerChange}
        answers={answers}
        t={t}
      />
    )
  }

  const visibleSections = sections.filter((section) => logicState.visibleSectionKeys.has(section.key) && section.kind !== 'ending')

  const stackedBody = (
    <div className={SPACE_BY_DENSITY[density]}>
      {visibleSections.map((section) => {
        const pageIndex = pages.findIndex((page) => page.sectionKeys.includes(section.key))
        const isFirstOfPage =
          pageIndex >= 0 && pages[pageIndex]?.sectionKeys[0] === section.key
        return renderSection(section, isFirstOfPage ? pageIndex : null)
      })}
      {visibleSections.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-sm text-muted-foreground">
          {t('forms.studio.canvas.empty.copy')}
        </p>
      ) : null}
    </div>
  )

  if (!isPaginated) {
    return stackedBody
  }

  const activePage = pages[activePageIndex]
  const activeSections = activePage
    ? activePage.sectionKeys
        .map((key) => sectionsByKey.get(key))
        .filter((section): section is ResolvedSectionView =>
          Boolean(section) && logicState.visibleSectionKeys.has(section!.key) && section!.kind !== 'ending',
        )
    : []

  const isLastPage = activePageIndex >= pages.length - 1
  const isFirstPage = activePageIndex === 0

  return (
    <div className={SPACE_BY_DENSITY[density]}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Author preview" className="flex flex-wrap gap-1">
          {pages.map((page, index) => {
            const isActive = index === activePageIndex
            const firstSectionKey = page.sectionKeys[0] ?? null
            const firstSection = firstSectionKey ? sectionsByKey.get(firstSectionKey) : null
            const localizedTitle = firstSection?.title?.en
            const tabLabel = localizedTitle && localizedTitle.length > 0
              ? localizedTitle
              : t('forms.studio.canvas.page.chipLabel', { n: String(index + 1) })
            return (
              <button
                key={firstSectionKey ?? index}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActivePageIndex(index)}
                className={
                  'rounded-md px-3 py-1 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring '
                  + (isActive
                    ? 'bg-muted text-foreground'
                    : 'border border-border bg-background text-muted-foreground hover:bg-muted/40')
                }
              >
                {tabLabel}
              </button>
            )
          })}
        </div>
        {progressActive ? (
          <span className="text-xs text-muted-foreground">
            {t('forms.runner.section.label', {
              current: String(activePageIndex + 1),
              total: String(pages.length),
            })}
          </span>
        ) : null}
      </div>
      <div className={SPACE_BY_DENSITY[density]}>
        {activeSections.map((section) => {
          const isFirstOfPage = activePage?.sectionKeys[0] === section.key
          return renderSection(section, isFirstOfPage ? activePageIndex : null)
        })}
        {activeSections.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-sm text-muted-foreground">
            {t('forms.studio.canvas.empty.copy')}
          </p>
        ) : null}
      </div>
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          disabled={isFirstPage}
          onClick={() => setActivePageIndex((current) => Math.max(0, current - 1))}
        >
          {t('forms.studio.preview.paginated.back')}
        </Button>
        <span className="text-xs text-muted-foreground">
          {isLastPage ? t('forms.studio.preview.paginated.submitNote') : null}
        </span>
        <Button
          type="button"
          disabled={isLastPage}
          onClick={() => setActivePageIndex((current) => Math.min(pages.length - 1, current + 1))}
        >
          {t('forms.studio.preview.paginated.next')}
        </Button>
      </div>
    </div>
  )
}

type SectionPreviewProps = {
  section: ResolvedSectionView
  schema: FormSchema
  previewRole: string
  viewport: PreviewViewport
  density: 'default' | 'compact' | 'spacious'
  labelPosition: 'top' | 'left'
  renderColumns: 1 | 2 | 3 | 4
  pageIndex: number | null
  showPageChip: boolean
  logicState: LogicState
  answers: Record<string, unknown>
  onAnswerChange: (fieldKey: string, value: unknown) => void
  t: TranslateFn
}

function SectionPreview({
  section,
  schema,
  previewRole,
  viewport,
  density,
  labelPosition,
  renderColumns,
  pageIndex,
  showPageChip,
  logicState,
  answers,
  onAnswerChange,
  t,
}: SectionPreviewProps) {
  void answers
  const title = section.title?.en ?? ''
  return (
    <section className="rounded-lg border border-border bg-background p-4">
      {showPageChip && pageIndex !== null ? (
        <div className="mb-2">
          <Tag variant="neutral" dot>
            {t('forms.studio.canvas.page.chipLabel', { n: String(pageIndex + 1) })}
          </Tag>
        </div>
      ) : null}
      {!section.hideTitle && title.length > 0 ? (
        <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      ) : null}
      {section.divider ? <Separator className="mb-3" /> : null}
      <div className={`grid ${COLUMNS_TO_GRID_CLASS[renderColumns]} ${GAP_BY_DENSITY[density]}`}>
        {section.fieldKeys.map((fieldKey) => {
          const node = schema.properties[fieldKey]
          if (!node) return null
          if (!logicState.visibleFieldKeys.has(fieldKey)) return null
          const visibleTo = (node['x-om-visible-to'] as string[] | undefined)
            ?? Array.from(
              new Set([
                ...((node['x-om-editable-by'] as string[] | undefined) ?? ['admin']),
                'admin',
              ]),
            )
          if (!visibleTo.includes(previewRole)) return null
          const omType = String(node['x-om-type'] ?? 'text')
          const editableBy = (node['x-om-editable-by'] as string[] | undefined) ?? ['admin']
          const canEdit = editableBy.includes(previewRole)
          const persistedSpan = readPersistedSpan(node['x-om-grid-span'])
          const isInfoBlock = omType === 'info_block'
          const renderSpan = isInfoBlock
            ? renderColumns
            : effectiveSpan(persistedSpan, renderColumns)
          const align = readAlign(node['x-om-align'])
          const hideOnMobile = node['x-om-hide-mobile'] === true
          if (hideOnMobile && viewport === 'mobile') return null
          const required = (schema.required ?? []).includes(fieldKey)
          return (
            <FieldPreviewRow
              key={fieldKey}
              fieldKey={fieldKey}
              node={node}
              omType={omType}
              canEdit={canEdit}
              required={required}
              renderSpan={renderSpan}
              align={align}
              labelPosition={labelPosition}
              value={answers[fieldKey]}
              onChange={(value) => onAnswerChange(fieldKey, value)}
              logicState={logicState}
              t={t}
            />
          )
        })}
      </div>
    </section>
  )
}

type FieldPreviewRowProps = {
  fieldKey: string
  node: FieldNode
  omType: string
  canEdit: boolean
  required: boolean
  renderSpan: 1 | 2 | 3 | 4
  align: 'start' | 'center' | 'end'
  labelPosition: 'top' | 'left'
  value: unknown
  onChange: (value: unknown) => void
  t: TranslateFn
}

function FieldPreviewRow({
  fieldKey,
  node,
  omType,
  canEdit,
  required,
  renderSpan,
  align,
  labelPosition,
  value,
  onChange,
  logicState,
  t,
}: FieldPreviewRowProps & { logicState: LogicState }) {
  const rawLabel = node['x-om-label'] as Record<string, string> | undefined
  const rawHelp = node['x-om-help'] as Record<string, string> | undefined
  const label = (rawLabel ? logicState.resolveRecall(rawLabel, 'en') : '') || fieldKey
  const help = rawHelp ? logicState.resolveRecall(rawHelp, 'en') : ''
  if (omType === 'info_block') {
    return (
      <div
        className={`${SPAN_TO_CLASS[renderSpan]} ${ALIGN_TO_CLASS[align]} rounded-md border border-border bg-muted/30 p-3`}
      >
        <p className="text-sm font-medium text-foreground">{label}</p>
        {help && (
          <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{help}</p>
        )}
      </div>
    )
  }
  const labelNode = (
    <label className="block text-sm font-medium text-foreground" htmlFor={`preview-${fieldKey}`}>
      {label}
      {required ? (
        <span className="ml-1 text-status-error-text" aria-hidden="true">
          *
        </span>
      ) : null}
    </label>
  )
  const helpNode = help ? (
    <p className="text-xs text-muted-foreground">{help}</p>
  ) : null
  const inputNode = (
    <FieldPreviewInput
      fieldKey={fieldKey}
      node={node}
      omType={omType}
      canEdit={canEdit}
      label={label}
      value={value}
      onChange={onChange}
    />
  )
  const baseClass = `${SPAN_TO_CLASS[renderSpan]} ${ALIGN_TO_CLASS[align]}`
  if (labelPosition === 'left') {
    return (
      <div className={`${baseClass} flex items-start gap-3`}>
        <div className="min-w-32 pt-2">{labelNode}</div>
        <div className="flex-1 space-y-1">
          {helpNode}
          {inputNode}
          {!canEdit ? (
            <span className="text-xs text-muted-foreground">{t('forms.runner.encrypted_label')}</span>
          ) : null}
        </div>
      </div>
    )
  }
  return (
    <div className={`${baseClass} space-y-1`}>
      {labelNode}
      {helpNode}
      {inputNode}
    </div>
  )
}

type FieldPreviewInputProps = {
  fieldKey: string
  node: FieldNode
  omType: string
  canEdit: boolean
  label: string
  value: unknown
  onChange: (value: unknown) => void
}

function FieldPreviewInput({
  fieldKey,
  node,
  omType,
  canEdit,
  label,
  value,
  onChange,
}: FieldPreviewInputProps) {
  const id = `preview-${fieldKey}`
  const options = Array.isArray(node['x-om-options'])
    ? (node['x-om-options'] as FieldOption[]).filter(
        (entry) => typeof entry?.value === 'string',
      )
    : []
  const optionLabel = (option: FieldOption) => option.label?.en ?? option.value
  const stringValue = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)
  switch (omType) {
    case 'textarea':
      return (
        <Textarea
          id={id}
          readOnly={!canEdit}
          rows={3}
          aria-label={label}
          value={stringValue}
          onChange={(event) => onChange(event.target.value)}
        />
      )
    case 'number':
      return (
        <Input
          id={id}
          readOnly={!canEdit}
          type="number"
          step="any"
          aria-label={label}
          value={stringValue}
          onChange={(event) => {
            const next = event.target.value
            onChange(next === '' ? '' : Number(next))
          }}
        />
      )
    case 'integer':
      return (
        <Input
          id={id}
          readOnly={!canEdit}
          type="number"
          step={1}
          aria-label={label}
          value={stringValue}
          onChange={(event) => {
            const next = event.target.value
            onChange(next === '' ? '' : Math.trunc(Number(next)))
          }}
        />
      )
    case 'boolean':
      return (
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            disabled={!canEdit}
            aria-label={label}
            checked={value === true}
            onCheckedChange={(next) => onChange(Boolean(next))}
          />
          <span>{label}</span>
        </label>
      )
    case 'yes_no':
      return (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">No</span>
          <Switch
            disabled={!canEdit}
            aria-label={label}
            checked={value === true}
            onCheckedChange={(next) => onChange(Boolean(next))}
          />
          <span className="text-muted-foreground">Yes</span>
        </div>
      )
    case 'date':
      return (
        <Input
          id={id}
          readOnly={!canEdit}
          type="date"
          aria-label={label}
          value={stringValue}
          onChange={(event) => onChange(event.target.value)}
        />
      )
    case 'datetime':
      return (
        <Input
          id={id}
          readOnly={!canEdit}
          type="datetime-local"
          aria-label={label}
          value={stringValue}
          onChange={(event) => onChange(event.target.value)}
        />
      )
    case 'select_one':
      return (
        <Select
          disabled={!canEdit}
          value={typeof value === 'string' ? value : undefined}
          onValueChange={(next) => onChange(next)}
        >
          <SelectTrigger id={id}>
            <SelectValue placeholder={options.length === 0 ? '— No options configured —' : 'Select…'} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {optionLabel(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    case 'select_many':
      if (options.length === 0) {
        return <p className="text-xs text-muted-foreground">— No options configured —</p>
      }
      return (
        <div className="space-y-1">
          {options.map((option) => {
            const selected = Array.isArray(value) && (value as unknown[]).includes(option.value)
            return (
              <label key={option.value} className="flex items-center gap-2 text-sm">
                <Checkbox
                  disabled={!canEdit}
                  checked={selected}
                  onCheckedChange={(next) => {
                    const current = Array.isArray(value) ? [...(value as string[])] : []
                    if (next) {
                      if (!current.includes(option.value)) current.push(option.value)
                    } else {
                      const idx = current.indexOf(option.value)
                      if (idx >= 0) current.splice(idx, 1)
                    }
                    onChange(current)
                  }}
                />
                <span>{optionLabel(option)}</span>
              </label>
            )
          })}
        </div>
      )
    case 'scale': {
      const minRaw = node['x-om-min']
      const maxRaw = node['x-om-max']
      const min = typeof minRaw === 'number' ? minRaw : 0
      const max = typeof maxRaw === 'number' ? maxRaw : 10
      const safeMax = max < min ? min : max
      const buttons: number[] = []
      for (let i = min; i <= safeMax; i += 1) buttons.push(i)
      const currentValue = typeof value === 'number' ? value : null
      return (
        <div className="flex flex-wrap gap-1">
          {buttons.map((entry) => {
            const isSelected = currentValue === entry
            return (
              <button
                key={entry}
                type="button"
                disabled={!canEdit}
                onClick={() => onChange(entry)}
                aria-pressed={isSelected}
                className={
                  'h-8 w-8 rounded-full border text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 '
                  + (isSelected
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:border-primary hover:text-primary')
                }
              >
                {entry}
              </button>
            )
          })}
        </div>
      )
    }
    case 'text':
    default:
      return (
        <Input
          id={id}
          readOnly={!canEdit}
          type="text"
          aria-label={label}
          value={stringValue}
          onChange={(event) => onChange(event.target.value)}
        />
      )
  }
}
