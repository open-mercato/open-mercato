export type IndexDocumentScope = {
  organizationId?: string | null
  tenantId?: string | null
}

export type IndexCustomFieldValue = {
  key: string
  value: unknown
  organizationId?: string | null
  tenantId?: string | null
}

function normalizeScopeValue(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === '') return null
  return value
}

function isScopedValueVisible(
  scopeValue: string | null,
  fieldValue: string | null,
): boolean {
  if (scopeValue === null) return fieldValue === null
  return fieldValue === null || fieldValue === scopeValue
}

function normalizeValue(value: unknown): unknown {
  if (value === undefined) return null
  return value
}

export function buildIndexDocument(
  baseRow: Record<string, unknown>,
  customFieldValues: Iterable<IndexCustomFieldValue> = [],
  scope: IndexDocumentScope = {},
): Record<string, unknown> {
  const doc: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(baseRow)) {
    doc[key] = value
  }

  const scopeOrg = normalizeScopeValue(scope.organizationId ?? null)
  const scopeTenant = normalizeScopeValue(scope.tenantId ?? null)

  const grouped = new Map<string, unknown[]>()
  for (const field of customFieldValues) {
    const org = normalizeScopeValue(field.organizationId ?? null)
    const tenant = normalizeScopeValue(field.tenantId ?? null)

    if (!isScopedValueVisible(scopeOrg, org)) continue
    if (!isScopedValueVisible(scopeTenant, tenant)) continue

    const bucketKey = `cf:${field.key}`
    let bucket = grouped.get(bucketKey)
    if (!bucket) {
      bucket = []
      grouped.set(bucketKey, bucket)
    }

    const { value } = field
    if (Array.isArray(value)) {
      for (const entry of value) bucket.push(normalizeValue(entry))
    } else {
      bucket.push(normalizeValue(value))
    }
  }

  for (const [key, values] of grouped.entries()) {
    if (values.length === 1) {
      doc[key] = values[0]
    } else if (values.length > 1) {
      doc[key] = values
    }
  }

  return doc
}
