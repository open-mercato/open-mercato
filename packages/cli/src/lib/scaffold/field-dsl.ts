/**
 * Field DSL for `mercato module scaffold` (spec:
 * .ai/specs/2026-07-05-ds-module-ui-scaffold.md).
 *
 * One `--fields` declaration drives four artifacts at once — the zod schema in
 * `data/validators.ts`, the `CrudField[]` in `components/formConfig.ts`, the
 * `ColumnDef[]` on the list page, and the i18n label keys — so they can never
 * disagree. All emitters are pure string builders: identical inputs produce
 * byte-identical output (CLI AGENTS.md determinism rule).
 */

export type ScaffoldFieldType = 'text' | 'textarea' | 'number' | 'select' | 'checkbox' | 'date'

export type ScaffoldField = {
  name: string
  type: ScaffoldFieldType
  required: boolean
  /** Present only for `select` fields. */
  options?: string[]
}

export class FieldDslError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FieldDslError'
  }
}

export const FIELD_NAME_PATTERN = /^[a-z][a-zA-Z0-9]*$/
const OPTION_PATTERN = /^[a-z][a-z0-9_]*$/
const KNOWN_TYPES: ScaffoldFieldType[] = ['text', 'textarea', 'number', 'select', 'checkbox', 'date']

/**
 * Columns that every scaffolded entity is assumed to carry (and that the
 * platform manages). They can never be redeclared through the DSL.
 */
export const RESERVED_FIELD_NAMES = [
  'id',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'organizationId',
  'tenantId',
  // List-API query params share one flat bag with field filters — a field
  // named like one of these would clobber pagination/search/export params
  // (e.g. `format:select(csv|json)` turns every filtered list call into a
  // CSV export). Reserved alongside the platform columns.
  'page',
  'pageSize',
  'search',
  'ids',
  'format',
  'full',
  'all',
  'exportScope',
  // Object prototype members survive the identifier regex but interact with
  // plain-object property lookups in generated code.
  'constructor',
  'toString',
  'valueOf',
  'hasOwnProperty',
] as const

export const FIELD_DSL_GRAMMAR = [
  '--fields grammar:',
  '  fields  = field[,field...]',
  '  field   = name:type[:required]',
  '  name    = camelCase identifier matching ^[a-z][a-zA-Z0-9]*$',
  `            (reserved, always present: ${RESERVED_FIELD_NAMES.join(', ')})`,
  '  type    = text | textarea | number | select(opt1|opt2[|...]) | checkbox | date',
  '  option  = identifier matching ^[a-z][a-z0-9_]*$ (select only, unique)',
  '',
  'Example: --fields "subject:text:required,status:select(open|closed),notes:textarea"',
].join('\n')

export function parseFieldsSpec(spec: string): ScaffoldField[] {
  const trimmed = spec.trim()
  if (!trimmed) {
    throw new FieldDslError('--fields must declare at least one field.')
  }

  const fields: ScaffoldField[] = []
  const seen = new Set<string>()

  for (const rawEntry of trimmed.split(',')) {
    const entry = rawEntry.trim()
    if (!entry) {
      throw new FieldDslError(`Empty field declaration in --fields "${spec}".`)
    }

    const segments = entry.split(':')
    if (segments.length < 2 || segments.length > 3) {
      throw new FieldDslError(`Malformed field declaration "${entry}" — expected name:type[:required].`)
    }

    const [name, typeSegment, requiredSegment] = segments

    if (!FIELD_NAME_PATTERN.test(name)) {
      throw new FieldDslError(`Invalid field name "${name}" — names must match ^[a-z][a-zA-Z0-9]*$.`)
    }
    if ((RESERVED_FIELD_NAMES as readonly string[]).includes(name)) {
      throw new FieldDslError(
        `Field name "${name}" is reserved — ${RESERVED_FIELD_NAMES.join(', ')} are always present and never redeclared.`,
      )
    }
    if (seen.has(name)) {
      throw new FieldDslError(`Duplicate field name "${name}".`)
    }

    if (requiredSegment !== undefined && requiredSegment !== 'required') {
      throw new FieldDslError(`Unknown field modifier "${requiredSegment}" in "${entry}" — only :required is supported.`)
    }
    const required = requiredSegment === 'required'

    const typeMatch = typeSegment.match(/^([a-z]+)(\((.*)\))?$/)
    if (!typeMatch) {
      throw new FieldDslError(`Malformed type "${typeSegment}" in "${entry}".`)
    }
    const typeName = typeMatch[1] as ScaffoldFieldType
    const hasOptions = typeMatch[2] !== undefined
    const rawOptions = typeMatch[3]

    if (!KNOWN_TYPES.includes(typeName)) {
      throw new FieldDslError(`Unknown field type "${typeName}" in "${entry}".`)
    }

    if (typeName === 'select') {
      if (!hasOptions || rawOptions === undefined || rawOptions.trim() === '') {
        throw new FieldDslError(`select field "${name}" needs options, e.g. ${name}:select(open|closed).`)
      }
      const options = rawOptions.split('|').map((opt) => opt.trim())
      const seenOptions = new Set<string>()
      for (const option of options) {
        if (!OPTION_PATTERN.test(option)) {
          throw new FieldDslError(
            `Invalid option "${option}" for select field "${name}" — options must match ^[a-z][a-z0-9_]*$.`,
          )
        }
        if (seenOptions.has(option)) {
          throw new FieldDslError(`Duplicate option "${option}" for select field "${name}".`)
        }
        seenOptions.add(option)
      }
      seen.add(name)
      fields.push({ name, type: typeName, required, options })
      continue
    }

    if (hasOptions) {
      throw new FieldDslError(`Type "${typeName}" does not take options (field "${name}").`)
    }

    seen.add(name)
    fields.push({ name, type: typeName, required })
  }

  return fields
}

// ---------------------------------------------------------------------------
// Naming helpers (shared by all emitters so labels/keys never diverge)
// ---------------------------------------------------------------------------

/** `priorityScore` / `in_progress` → `Priority score` / `In progress`. */
export function humanizeIdentifier(identifier: string): string {
  const words = identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase()
    .trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** `support_tickets` → `SupportTickets`; `ticket` → `Ticket`. */
export function pascalCase(identifier: string): string {
  return identifier
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

/** `support_tickets` → `supportTickets`. */
export function camelCase(identifier: string): string {
  const pascal = pascalCase(identifier)
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

/** `ticket_item` → `TICKET_ITEM`. */
export function upperSnakeCase(identifier: string): string {
  return identifier.toUpperCase()
}

/** The `select` field rendered through StatusBadge + StatusMap, if declared. */
export function findStatusField(fields: ScaffoldField[]): ScaffoldField | null {
  return fields.find((field) => field.type === 'select' && field.name === 'status') ?? null
}

export function selectFields(fields: ScaffoldField[]): ScaffoldField[] {
  return fields.filter((field) => field.type === 'select')
}

export function hasCheckboxField(fields: ScaffoldField[]): boolean {
  return fields.some((field) => field.type === 'checkbox')
}

// ---------------------------------------------------------------------------
// zod emitter (data/validators.ts body)
// ---------------------------------------------------------------------------

function zodFragment(field: ScaffoldField): string {
  switch (field.type) {
    case 'text':
    case 'textarea':
      return field.required ? 'z.string().min(1)' : 'z.string().optional()'
    case 'number':
      return field.required ? 'z.coerce.number()' : 'z.coerce.number().optional()'
    case 'select': {
      const options = (field.options ?? []).map((opt) => `'${opt}'`).join(', ')
      return field.required ? `z.enum([${options}])` : `z.enum([${options}]).optional()`
    }
    case 'checkbox':
      return field.required ? 'z.boolean()' : 'z.boolean().optional()'
    case 'date':
      return field.required ? 'z.coerce.date()' : 'z.coerce.date().optional()'
  }
}

export function emitZodFieldLines(fields: ScaffoldField[]): string {
  return fields.map((field) => `  ${field.name}: ${zodFragment(field)},`).join('\n')
}

// ---------------------------------------------------------------------------
// CrudField emitter (components/formConfig.ts body)
// ---------------------------------------------------------------------------

function crudFieldType(field: ScaffoldField): string {
  return field.type
}

export function emitCrudFieldLines(fields: ScaffoldField[], i18nPrefix: string): string {
  const lines: string[] = []
  for (const field of fields) {
    const label = `t('${i18nPrefix}.fields.${field.name}', '${humanizeIdentifier(field.name)}')`
    if (field.type === 'select') {
      lines.push('    {')
      lines.push(`      id: '${field.name}',`)
      lines.push(`      label: ${label},`)
      lines.push(`      type: 'select',`)
      if (field.required) lines.push('      required: true,')
      lines.push('      options: [')
      for (const option of field.options ?? []) {
        lines.push(
          `        { value: '${option}', label: t('${i18nPrefix}.fields.${field.name}.options.${option}', '${humanizeIdentifier(option)}') },`,
        )
      }
      lines.push('      ],')
      lines.push('    },')
      continue
    }
    const requiredPart = field.required ? ', required: true' : ''
    lines.push(`    { id: '${field.name}', label: ${label}, type: '${crudFieldType(field)}'${requiredPart} },`)
  }
  return lines.join('\n')
}

export function emitFieldIdList(fields: ScaffoldField[]): string {
  return fields.map((field) => `'${field.name}'`).join(', ')
}

// ---------------------------------------------------------------------------
// ColumnDef emitter (list page body)
// ---------------------------------------------------------------------------

export function emitColumnLines(
  fields: ScaffoldField[],
  i18nPrefix: string,
  statusMapIdent: string | null,
): string {
  const lines: string[] = []
  for (const field of fields) {
    // Spec: textarea fields are excluded from the default column set.
    if (field.type === 'textarea') continue
    const header = `t('${i18nPrefix}.fields.${field.name}', '${humanizeIdentifier(field.name)}')`
    switch (field.type) {
      case 'text':
        lines.push(`    { accessorKey: '${field.name}', header: ${header} },`)
        break
      case 'number':
        lines.push('    {')
        lines.push(`      accessorKey: '${field.name}',`)
        lines.push(`      header: ${header},`)
        lines.push(
          `      cell: ({ row }) => <div className="text-right tabular-nums">{row.original.${field.name} ?? null}</div>,`,
        )
        lines.push('    },')
        break
      case 'checkbox':
        lines.push('    {')
        lines.push(`      accessorKey: '${field.name}',`)
        lines.push(`      header: ${header},`)
        lines.push(
          `      cell: ({ row }) => (row.original.${field.name} ? t('${i18nPrefix}.list.boolean.yes', 'Yes') : t('${i18nPrefix}.list.boolean.no', 'No')),`,
        )
        lines.push('    },')
        break
      case 'date':
        lines.push('    {')
        lines.push(`      accessorKey: '${field.name}',`)
        lines.push(`      header: ${header},`)
        lines.push(
          `      cell: ({ row }) => (row.original.${field.name} ? new Date(row.original.${field.name} as string).toLocaleDateString() : null),`,
        )
        lines.push('    },')
        break
      case 'select': {
        if (statusMapIdent && field.name === 'status') {
          lines.push('    {')
          lines.push(`      accessorKey: 'status',`)
          lines.push(`      header: ${header},`)
          lines.push('      cell: ({ row }) => {')
          lines.push('        const status = row.original.status')
          lines.push('        if (!status) return null')
          lines.push('        return (')
          lines.push(`          <StatusBadge variant={${statusMapIdent}[status] ?? 'neutral'} dot>`)
          lines.push(`            {t('${i18nPrefix}.fields.status.options.' + status, status)}`)
          lines.push('          </StatusBadge>')
          lines.push('        )')
          lines.push('      },')
          lines.push('    },')
        } else {
          lines.push('    {')
          lines.push(`      accessorKey: '${field.name}',`)
          lines.push(`      header: ${header},`)
          lines.push(
            `      cell: ({ row }) => (row.original.${field.name} ? t('${i18nPrefix}.fields.${field.name}.options.' + row.original.${field.name}, row.original.${field.name}) : null),`,
          )
          lines.push('    },')
        }
        break
      }
    }
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Row/record type emitter (list + detail pages)
// ---------------------------------------------------------------------------

function rowFieldType(field: ScaffoldField, statusTypeIdent: string | null): string {
  switch (field.type) {
    case 'text':
    case 'textarea':
      return 'string'
    case 'number':
      return 'number'
    case 'checkbox':
      return 'boolean'
    case 'date':
      return 'string'
    case 'select': {
      if (statusTypeIdent && field.name === 'status') return statusTypeIdent
      return (field.options ?? []).map((opt) => `'${opt}'`).join(' | ')
    }
  }
}

export function emitRowTypeLines(fields: ScaffoldField[], statusTypeIdent: string | null): string {
  return fields
    .map((field) => {
      const tsType = rowFieldType(field, statusTypeIdent)
      return field.required ? `  ${field.name}: ${tsType}` : `  ${field.name}?: ${tsType} | null`
    })
    .join('\n')
}

// ---------------------------------------------------------------------------
// initialValues emitter (detail page edit form)
// ---------------------------------------------------------------------------

export function emitInitialValueLines(fields: ScaffoldField[]): string {
  return fields
    .map((field) => {
      if (field.type === 'date') {
        return `      ${field.name}: record.${field.name} ? new Date(record.${field.name}) : undefined,`
      }
      if (field.required) {
        return `      ${field.name}: record.${field.name},`
      }
      return `      ${field.name}: record.${field.name} ?? undefined,`
    })
    .join('\n')
}

// ---------------------------------------------------------------------------
// Quick filters emitter (list page FilterBar defs for select fields)
// ---------------------------------------------------------------------------

export function emitFilterDefLines(fields: ScaffoldField[], i18nPrefix: string): string {
  const lines: string[] = []
  for (const field of selectFields(fields)) {
    lines.push('    {')
    lines.push(`      id: '${field.name}',`)
    lines.push(`      label: t('${i18nPrefix}.fields.${field.name}', '${humanizeIdentifier(field.name)}'),`)
    lines.push(`      type: 'select',`)
    lines.push('      options: [')
    for (const option of field.options ?? []) {
      lines.push(
        `        { value: '${option}', label: t('${i18nPrefix}.fields.${field.name}.options.${option}', '${humanizeIdentifier(option)}') },`,
      )
    }
    lines.push('      ],')
    lines.push('    },')
  }
  return lines.join('\n')
}

export function emitFilterParamLines(fields: ScaffoldField[]): string {
  return selectFields(fields)
    .map(
      (field) =>
        `    if (typeof filterValues.${field.name} === 'string' && filterValues.${field.name}) params.${field.name} = filterValues.${field.name}`,
    )
    .join('\n')
}

// ---------------------------------------------------------------------------
// StatusMap emitter (components/statusMap.ts)
// ---------------------------------------------------------------------------

const STATUS_VARIANT_BY_NAME: Record<string, string> = {
  active: 'success',
  approved: 'success',
  complete: 'success',
  completed: 'success',
  done: 'success',
  paid: 'success',
  published: 'success',
  resolved: 'success',
  won: 'success',
  archived: 'neutral',
  canceled: 'neutral',
  cancelled: 'neutral',
  closed: 'neutral',
  disabled: 'neutral',
  draft: 'neutral',
  inactive: 'neutral',
  in_progress: 'info',
  new: 'info',
  open: 'info',
  pending: 'info',
  processing: 'info',
  review: 'info',
  at_risk: 'warning',
  on_hold: 'warning',
  overdue: 'warning',
  paused: 'warning',
  warning: 'warning',
  blocked: 'error',
  error: 'error',
  failed: 'error',
  lost: 'error',
  rejected: 'error',
}

export function statusVariantFor(option: string): string {
  return STATUS_VARIANT_BY_NAME[option] ?? 'neutral'
}

export function emitStatusUnion(statusField: ScaffoldField): string {
  return (statusField.options ?? []).map((opt) => `'${opt}'`).join(' | ')
}

export function emitStatusMapEntries(statusField: ScaffoldField): string {
  return (statusField.options ?? []).map((opt) => `  ${opt}: '${statusVariantFor(opt)}',`).join('\n')
}

// ---------------------------------------------------------------------------
// i18n emitter (field-derived keys; page-level copy lives in the orchestrator)
// ---------------------------------------------------------------------------

export function buildFieldI18nEntries(fields: ScaffoldField[], i18nPrefix: string): Record<string, string> {
  const entries: Record<string, string> = {}
  for (const field of fields) {
    entries[`${i18nPrefix}.fields.${field.name}`] = humanizeIdentifier(field.name)
    if (field.type === 'select') {
      for (const option of field.options ?? []) {
        entries[`${i18nPrefix}.fields.${field.name}.options.${option}`] = humanizeIdentifier(option)
      }
    }
  }
  return entries
}
