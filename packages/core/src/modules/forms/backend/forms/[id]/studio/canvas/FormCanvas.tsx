'use client'

import * as React from 'react'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import {
  linearizeFields,
  UNGROUPED_SECTION_KEY,
  type FormSchema,
} from '../schema-helpers'
import type { ActiveDropTarget, StudioSelection } from '../types'
import { fieldDraggableId, FieldRow } from './FieldRow'
import {
  SectionContainer,
  SectionGridBody,
  sectionDraggableId,
} from './SectionContainer'
import {
  partitionPages,
  resolveSectionViews,
} from '../../../../../services/form-version-compiler'
import { computeRowLayout, readSpan } from './row-layout'

export type FieldResizeState = {
  fieldKey: string
  sectionKey: string
  startSpan: 1 | 2 | 3 | 4
  previewSpan: 1 | 2 | 3 | 4
} | null

export function FormCanvas({
  schema,
  selectedKey,
  onSelectField,
  onSelectSection,
  onDeleteField,
  onDeleteSection,
  onMoveField,
  onMoveSection,
  onAdoptUngrouped,
  onSectionTitleCommit,
  focusSectionTitleKey,
  onSectionTitleFocusConsumed,
  activeLocale,
  activeDropTarget,
  resizeState,
  onFieldResizeStart,
  onFieldResizePreview,
  onFieldResizeCommit,
  gridRefs,
  t,
}: {
  schema: FormSchema
  selectedKey: StudioSelection
  onSelectField: (fieldKey: string) => void
  onSelectSection: (sectionKey: string) => void
  onDeleteField: (fieldKey: string) => void
  onDeleteSection: (sectionKey: string) => void
  onMoveField: (fieldKey: string, direction: 'up' | 'down') => void
  onMoveSection: (sectionKey: string, direction: 'up' | 'down') => void
  onAdoptUngrouped: () => void
  onSectionTitleCommit: (sectionKey: string, title: string) => void
  focusSectionTitleKey: string | null
  onSectionTitleFocusConsumed: () => void
  activeLocale: string
  t: TranslateFn
  activeDropTarget?: ActiveDropTarget
  resizeState?: FieldResizeState
  onFieldResizeStart?: (input: { fieldKey: string; sectionKey: string; startSpan: 1 | 2 | 3 | 4 }) => void
  onFieldResizePreview?: (input: { fieldKey: string; previewSpan: 1 | 2 | 3 | 4 }) => void
  onFieldResizeCommit?: (input: { fieldKey: string; finalSpan: 1 | 2 | 3 | 4 }) => void
  // Phase 4 — optional ref-prop ownership: when supplied, FormCanvas writes
  // each section's grid node into this Map so parent components can measure
  // section width (e.g., to size the drag overlay). Falls back to a private
  // ref when not provided so resize-from-FieldRow keeps working in isolation.
  gridRefs?: React.MutableRefObject<Map<string, HTMLDivElement | null>>
}) {
  const sections = React.useMemo(
    () => resolveSectionViews(schema as Record<string, unknown>),
    [schema],
  )
  const pages = React.useMemo(() => partitionPages(sections), [sections])
  const fields = React.useMemo(() => linearizeFields(schema), [schema])
  const claimedFields = new Set(sections.flatMap((section) => section.fieldKeys))
  const ungroupedFields = fields.filter((entry) => !entry.sectionKey || !claimedFields.has(entry.key))
  const sectionIds = sections.map((section) => sectionDraggableId(section.key))
  const localGridRefs = React.useRef<Map<string, HTMLDivElement | null>>(new Map())
  const effectiveGridRefs = gridRefs ?? localGridRefs
  const registerGridRef = React.useCallback(
    (sectionKey: string) => (node: HTMLDivElement | null) => {
      const map = effectiveGridRefs.current
      if (node) {
        map.set(sectionKey, node)
      } else {
        map.delete(sectionKey)
      }
    },
    [effectiveGridRefs],
  )

  if (sections.length === 0 && Object.keys(schema.properties).length === 0) {
    return (
      <Alert>
        <h3 className="font-medium">{t('forms.studio.canvas.firstRun.title')}</h3>
        <p className="mt-1 text-sm">{t('forms.studio.canvas.firstRun.body')}</p>
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      <SortableContext items={sectionIds} strategy={verticalListSortingStrategy}>
        {sections.map((section, sectionIndex) => {
          const pageIndex = pages.findIndex((page) => page.sectionKeys.includes(section.key))
          const isFirstOfPage =
            pageIndex >= 0 && pages[pageIndex]?.sectionKeys[0] === section.key
          const fieldKeys = section.fieldKeys.filter((fieldKey) => schema.properties[fieldKey])
          const getSectionRect = () => {
            const node = effectiveGridRefs.current.get(section.key)
            return node ? node.getBoundingClientRect() : null
          }
          return (
            <SectionContainer
              key={section.key}
              view={section}
              isSelected={selectedKey?.kind === 'section' && selectedKey.key === section.key}
              onSelect={onSelectSection}
              onDelete={onDeleteSection}
              onMove={onMoveSection}
              onTitleCommit={onSectionTitleCommit}
              activeLocale={activeLocale}
              pageIndex={isFirstOfPage ? pageIndex : null}
              pageChipLabel={isFirstOfPage && pages.length > 1
                ? t('forms.studio.canvas.page.chipLabel', { n: String(pageIndex + 1) })
                : null}
              emptyDropCopy={t('forms.studio.canvas.dropHere.field')}
              titlePlaceholder={t('forms.studio.canvas.section.title.placeholder')}
              deleteAriaLabel={t('forms.studio.canvas.section.delete.ariaLabel')}
              dragHandleAriaLabel={t('forms.studio.canvas.section.dragHandle')}
              moveUpAriaLabel={t('forms.studio.canvas.section.moveUp')}
              moveDownAriaLabel={t('forms.studio.canvas.section.moveDown')}
              canMoveUp={sectionIndex > 0}
              canMoveDown={sectionIndex < sections.length - 1}
              dropIndicator={
                activeDropTarget?.kind === 'sortable' &&
                activeDropTarget.id === sectionDraggableId(section.key)
                  ? activeDropTarget.position
                  : null
              }
              t={t}
              isFocusedForTitleEdit={focusSectionTitleKey === section.key}
              onTitleEditConsumed={onSectionTitleFocusConsumed}
            >
              <SortableContext
                items={fieldKeys.map((fieldKey) => fieldDraggableId(fieldKey))}
                strategy={verticalListSortingStrategy}
              >
                {(() => {
                  const spans: Record<string, number | undefined> = {}
                  for (const fieldKey of fieldKeys) {
                    spans[fieldKey] = readSpan(schema.properties[fieldKey]?.['x-om-grid-span'])
                  }
                  const layoutPlan = computeRowLayout({
                    fieldKeys,
                    spans,
                    columns: section.columns,
                  })
                  const renderField = (fieldKey: string, fieldIndex: number) => (
                    <FieldRow
                      key={fieldKey}
                      fieldKey={fieldKey}
                      node={schema.properties[fieldKey]}
                      isSelected={selectedKey?.kind === 'field' && selectedKey.key === fieldKey}
                      onSelect={onSelectField}
                      onDelete={onDeleteField}
                      onMove={onMoveField}
                      canMoveUp={fieldIndex > 0}
                      canMoveDown={fieldIndex < fieldKeys.length - 1}
                      dropIndicator={
                        activeDropTarget?.kind === 'sortable' &&
                        activeDropTarget.id === fieldDraggableId(fieldKey)
                          ? activeDropTarget.position
                          : null
                      }
                      dropIndicatorGap={section.gap}
                      columns={section.columns}
                      gap={section.gap}
                      getSectionRect={getSectionRect}
                      onResizeStart={(key, startSpan) =>
                        onFieldResizeStart?.({ fieldKey: key, sectionKey: section.key, startSpan })
                      }
                      onResizePreview={(key, previewSpan) =>
                        onFieldResizePreview?.({ fieldKey: key, previewSpan })
                      }
                      onResizeCommit={(key, finalSpan) =>
                        onFieldResizeCommit?.({ fieldKey: key, finalSpan })
                      }
                      activeLocale={activeLocale}
                      t={t}
                    />
                  )
                  const sectionDropTarget =
                    activeDropTarget &&
                    activeDropTarget.kind !== 'sortable' &&
                    activeDropTarget.sectionKey === section.key
                      ? activeDropTarget
                      : null
                  const sectionResize =
                    resizeState && resizeState.sectionKey === section.key ? resizeState : null
                  return (
                    <SectionGridBody
                      view={section}
                      isEmpty={fieldKeys.length === 0}
                      emptyCopy={t('forms.studio.canvas.dropHere.field')}
                      layoutPlan={layoutPlan}
                      renderField={renderField}
                      gridDropTarget={sectionDropTarget}
                      resizingFieldKey={sectionResize?.fieldKey ?? null}
                      resizingPreviewSpan={sectionResize?.previewSpan ?? null}
                      gridRef={registerGridRef(section.key)}
                    >
                      {fieldKeys.map((fieldKey, fieldIndex) => renderField(fieldKey, fieldIndex))}
                    </SectionGridBody>
                  )
                })()}
              </SortableContext>
            </SectionContainer>
          )
        })}
      </SortableContext>
      {ungroupedFields.length > 0 ? (
        <section className="rounded-lg border border-dashed border-border bg-muted/20 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              {t('forms.studio.canvas.ungrouped.heading.label')}
            </h3>
            <Button type="button" variant="outline" size="sm" onClick={onAdoptUngrouped}>
              {t('forms.studio.canvas.ungrouped.adopt.button')}
            </Button>
          </div>
          <div data-section-key={UNGROUPED_SECTION_KEY} className="space-y-2">
            {ungroupedFields.map((entry, index) => (
              <FieldRow
                key={entry.key}
                fieldKey={entry.key}
                node={schema.properties[entry.key]}
                isSelected={selectedKey?.kind === 'field' && selectedKey.key === entry.key}
                onSelect={onSelectField}
                onDelete={onDeleteField}
                onMove={onMoveField}
                canMoveUp={index > 0}
                canMoveDown={index < ungroupedFields.length - 1}
                dropIndicator={null}
                activeLocale={activeLocale}
                t={t}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
