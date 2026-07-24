import { z } from 'zod'

/**
 * Shared compose-prop contracts for the field-bearing gallery entries
 * (spec `.ai/specs/2026-07-05-ds-live-mockup-composer.md`, Phase 3).
 *
 * These schemas live here — plain zod, no React — because THREE consumers
 * share them: the gallery entries (`table` in display.tsx, `form-field` in
 * inputs.tsx) use them as `composePropsSchema` + parse inside `compose()`,
 * the draft generator (`generation.ts`) constructs props that must satisfy
 * them, and the promote bridge (`promote.ts`) reads them back to derive the
 * scaffold `--fields` DSL. One schema, three walks — the derivation contract
 * is exactly what the integrity gate already validated.
 *
 * Field `name`s are camelCase by construction so the promote bridge maps them
 * 1:1 onto the scaffold `--fields` grammar (`name:type[:required]`, types
 * text|textarea|number|select(a|b)|checkbox|date).
 */

/** The scaffold `--fields` DSL types — shared vocabulary for columns, form fields, and flow outlines. */
export const SCAFFOLD_FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'select',
  'checkbox',
  'date',
] as const
export type ScaffoldFieldType = (typeof SCAFFOLD_FIELD_TYPES)[number]

/** camelCase identifier — first char lowercase letter, no separators. */
export const CAMEL_CASE_NAME = /^[a-z][A-Za-z0-9]*$/

const selectNeedsOptions = (
  value: { type?: string; kind?: string; options?: string[] },
  ctx: z.RefinementCtx,
) => {
  const fieldType = value.type ?? value.kind
  if (fieldType === 'select' && (!value.options || value.options.length === 0)) {
    ctx.addIssue({
      code: 'custom',
      message: 'select fields must list their options',
      path: ['options'],
    })
  }
  if (fieldType !== 'select' && value.options !== undefined) {
    ctx.addIssue({
      code: 'custom',
      message: 'options are only valid on select fields',
      path: ['options'],
    })
  }
}

/** One column of a composed `table` block. `type` defaults to text for promotion. */
export const tableColumnSchema = z
  .object({
    id: z.string().regex(CAMEL_CASE_NAME, 'column ids must be camelCase'),
    label: z.string().min(1),
    type: z.enum(SCAFFOLD_FIELD_TYPES).optional(),
    options: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict()
  .superRefine(selectNeedsOptions)
export type TableColumn = z.infer<typeof tableColumnSchema>

/**
 * Composer contract for `table` blocks in `*.mockup.json` — strict so unknown
 * keys fail the mockup registry-integrity test instead of being dropped.
 * Rows are keyed by column id; missing cells render blank. `emptyState`
 * states the list's empty behavior (and satisfies the mechanical
 * `om-empty-state-next-action` check, which looks for an `/empty/i` prop key).
 */
export const tableComposeSchema = z
  .object({
    columns: z.array(tableColumnSchema).min(1),
    rows: z
      .array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])))
      .optional(),
    emptyState: z
      .object({
        title: z.string().min(1),
        actionLabel: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
export type TableComposeProps = z.infer<typeof tableComposeSchema>

/**
 * Composer contract for `form-field` blocks. One block = one field, so a form
 * step in a flow outline becomes one `form-field` block per field and the
 * promote bridge reads `name`/`kind`/`required`/`options` straight into the
 * `--fields` DSL.
 */
export const formFieldComposeSchema = z
  .object({
    name: z.string().regex(CAMEL_CASE_NAME, 'field names must be camelCase'),
    label: z.string().min(1),
    kind: z.enum(SCAFFOLD_FIELD_TYPES),
    required: z.boolean().optional(),
    placeholder: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    options: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict()
  .superRefine(selectNeedsOptions)
export type FormFieldComposeProps = z.infer<typeof formFieldComposeSchema>
