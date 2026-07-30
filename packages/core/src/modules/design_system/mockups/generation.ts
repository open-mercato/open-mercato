import {
  mockupDocument,
  type MockupDocument,
  type MockupLayoutNode,
} from './schema'
import type { FlowField, FlowIntent, FlowOutline, FlowScreen } from './flow'
import type { TableComposeProps, FormFieldComposeProps } from './composeContracts'

/**
 * Outline-driven draft generation — spec
 * `.ai/specs/2026-07-05-ds-live-mockup-composer.md`, Phase 3.
 *
 * A DETERMINISTIC, pure mapping from a validated flow outline to draft mockup
 * documents: same outline in, byte-identical documents out (golden-pinned by
 * `generation.test.ts`). No fs, no registry imports — the caller passes the
 * set of known gallery entry ids so every block choice is verified against
 * the ACTUAL registry; a mapped entry that does not exist degrades to an
 * honest placeholder instead of a broken reference.
 *
 * Every generated document is `draft: true` and every generated block is
 * `status: 'proposed'` — a draft is a starting point, never auto-final;
 * nothing here (or anywhere else in code) clears the flag without the
 * explicit finalize intent.
 */

/** Entry ids the generator maps intents onto — each verified against the registry at run time. */
export const GENERATION_ENTRY_IDS = {
  sectionHeader: 'section-header',
  filterBar: 'filter-bar',
  table: 'table',
  formHeader: 'form-header',
  formField: 'form-field',
  formFooter: 'form-footer',
  kpiCard: 'kpi-card',
  detailFields: 'detail-fields-section',
  emptyState: 'empty-state',
} as const

export type DraftGenerationResult = {
  documents: MockupDocument[]
  /** Reviewer-facing notes: every placeholder emitted and why. */
  notes: string[]
}

/** 'firstName' → 'First name' */
export function humanizeFieldName(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function fieldLabel(field: FlowField): string {
  return field.label ?? humanizeFieldName(field.name)
}

const SAMPLE_ROW_COUNT = 3

/** Deterministic, clearly fictional cell sample per column type and row index. */
function sampleCellValue(field: FlowField, rowIndex: number): string | number | boolean {
  const type = field.type ?? 'text'
  if (type === 'number') return (rowIndex + 1) * 12
  if (type === 'checkbox') return rowIndex % 2 === 0
  if (type === 'date') return `2026-07-0${rowIndex + 1}`
  if (type === 'select') {
    const options = field.options ?? []
    return options[rowIndex % options.length] ?? ''
  }
  if (type === 'textarea') return `${fieldLabel(field)} note ${rowIndex + 1}`
  return `${fieldLabel(field)} sample ${rowIndex + 1}`
}

function tablePropsFor(fields: FlowField[]): TableComposeProps {
  const columns = fields.map((field) => ({
    id: field.name,
    label: fieldLabel(field),
    ...(field.type ? { type: field.type } : {}),
    ...(field.options ? { options: field.options } : {}),
  }))
  const rows = Array.from({ length: SAMPLE_ROW_COUNT }, (_, rowIndex) => {
    const row: Record<string, string | number | boolean> = {}
    for (const field of fields) row[field.name] = sampleCellValue(field, rowIndex)
    return row
  })
  return {
    columns,
    rows,
    emptyState: { title: 'Nothing here yet', actionLabel: 'Add the first record' },
  }
}

function formFieldPropsFor(field: FlowField): FormFieldComposeProps {
  return {
    name: field.name,
    label: fieldLabel(field),
    kind: field.type ?? 'text',
    ...(field.required ? { required: true } : {}),
    ...(field.options ? { options: field.options } : {}),
  }
}

type GenerationContext = {
  entryIds: Set<string>
  notes: string[]
  screenSlug: string
}

function annotation(intent: FlowIntent, note?: string) {
  return {
    status: 'proposed' as const,
    ...(intent.userStory ? { userStory: intent.userStory } : {}),
    ...(note ? { note } : {}),
  }
}

function placeholderFor(
  context: GenerationContext,
  intent: FlowIntent,
  id: string,
  reason: string,
): MockupLayoutNode {
  context.notes.push(`[${context.screenSlug}] placeholder "${id}": ${reason}`)
  return {
    type: 'placeholder',
    id,
    label: intent.description,
    ...annotation(intent, reason),
  }
}

function block(
  context: GenerationContext,
  intent: FlowIntent,
  id: string,
  entry: string,
  extra: { variant?: string; props?: Record<string, unknown>; note?: string } = {},
): MockupLayoutNode {
  if (!context.entryIds.has(entry)) {
    // Verified against the ACTUAL registry: a missing entry becomes an honest
    // placeholder, never a dangling reference that fails integrity.
    return placeholderFor(
      context,
      intent,
      id,
      `gallery entry "${entry}" is not in the registry`,
    )
  }
  return {
    type: 'block',
    id,
    entry,
    ...(extra.variant ? { variant: extra.variant } : {}),
    ...(extra.props ? { props: extra.props } : {}),
    ...annotation(intent, extra.note),
  }
}

function nodesForIntent(
  context: GenerationContext,
  intent: FlowIntent,
  intentIndex: number,
): MockupLayoutNode[] {
  const prefix = `i${intentIndex + 1}`
  const ids = GENERATION_ENTRY_IDS

  if (intent.kind === 'list') {
    const nodes: MockupLayoutNode[] = [
      block(context, intent, `${prefix}-header`, ids.sectionHeader, {
        props: { title: intent.description },
      }),
      block(context, intent, `${prefix}-filters`, ids.filterBar, {
        variant: 'stacked',
        note: 'Standard platform filter bar; configure the filter set during review.',
      }),
    ]
    if (intent.fields && intent.fields.length > 0) {
      nodes.push(
        block(context, intent, `${prefix}-table`, ids.table, {
          props: tablePropsFor(intent.fields) as unknown as Record<string, unknown>,
        }),
      )
    } else {
      nodes.push(
        block(context, intent, `${prefix}-table`, ids.table, {
          variant: 'default',
          note: 'Columns not specified in the flow outline, define them during review.',
        }),
      )
    }
    return nodes
  }

  if (intent.kind === 'form') {
    if (!intent.fields || intent.fields.length === 0) {
      return [placeholderFor(context, intent, `${prefix}-form`, 'form intent lists no fields')]
    }
    return [
      block(context, intent, `${prefix}-form-header`, ids.formHeader, {
        note: intent.description,
      }),
      ...intent.fields.map((field) =>
        block(context, intent, `${prefix}-field-${field.name}`, ids.formField, {
          props: formFieldPropsFor(field) as unknown as Record<string, unknown>,
        }),
      ),
      block(context, intent, `${prefix}-form-footer`, ids.formFooter, {
        note: 'Standard form footer (save/cancel per DS conventions).',
      }),
    ]
  }

  if (intent.kind === 'dashboard') {
    if (!intent.fields || intent.fields.length === 0) {
      return [placeholderFor(context, intent, `${prefix}-kpis`, 'dashboard intent lists no fields')]
    }
    const children = intent.fields.map((field, index) =>
      block(context, intent, `${prefix}-kpi-${field.name}`, ids.kpiCard, {
        props: {
          title: fieldLabel(field),
          value: (index + 1) * 128,
          comparisonLabel: 'sample data',
        },
      }),
    )
    return [
      {
        type: 'columns',
        id: `${prefix}-kpis`,
        weights: children.map(() => 1),
        children,
      },
    ]
  }

  if (intent.kind === 'detail') {
    return [
      block(context, intent, `${prefix}-header`, ids.sectionHeader, {
        props: { title: intent.description },
      }),
      block(context, intent, `${prefix}-detail`, ids.detailFields, {
        note: 'Detail fields per the DS detail-section pattern; bind real fields during implementation.',
      }),
    ]
  }

  if (intent.kind === 'feedback') {
    return [
      block(context, intent, `${prefix}-feedback`, ids.emptyState, {
        note: intent.description,
      }),
    ]
  }

  // action / navigation (and any future kind without a concrete mapping):
  // an honest placeholder carrying the intent as its label.
  return [
    placeholderFor(
      context,
      intent,
      `${prefix}-${intent.kind}`,
      `no deterministic block mapping for "${intent.kind}" intents, compose by hand during review`,
    ),
  ]
}

export function generateDraftDocument(
  outline: FlowOutline,
  screen: FlowScreen,
  entryIds: Set<string>,
  notes: string[] = [],
): MockupDocument {
  const context: GenerationContext = { entryIds, notes, screenSlug: screen.slug }
  const children = screen.intents.flatMap((intent, index) => nodesForIntent(context, intent, index))
  const statesLine =
    screen.states && screen.states.length > 0
      ? ` States to cover: ${screen.states.join(', ')}.`
      : ''
  const raw = {
    version: 1 as const,
    slug: screen.slug,
    title: screen.purpose,
    description: `Generated draft from flow outline "${outline.source}" (review required, never auto-final).${statesLine}`,
    width: 'desktop' as const,
    ...(outline.source.endsWith('.md') ? { spec: outline.source } : {}),
    draft: true,
    ...(outline.entity ? { entity: outline.entity } : {}),
    ...(outline.module ? { module: outline.module } : {}),
    root: { type: 'stack' as const, id: 'page', gap: 6 as const, children },
  }
  // A generation bug must fail loudly, not write an invalid document.
  return mockupDocument.parse(raw)
}

export function generateDraftDocuments(
  outline: FlowOutline,
  entryIds: Set<string>,
): DraftGenerationResult {
  const notes: string[] = []
  const screens = [...outline.screens].sort((a, b) => a.order - b.order)
  const documents = screens.map((screen) => generateDraftDocument(outline, screen, entryIds, notes))
  return { documents, notes }
}
