export const CRUD_WIDGET_PAYLOAD_KEY = '__omWidgetPayload'

export type CrudWidgetPayload = Record<string, Record<string, unknown>>

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function sanitizeCrudWidgetValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) {
    return value.map(sanitizeCrudWidgetValue).filter((item) => item !== undefined)
  }
  if (!isRecord(value)) return undefined
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    const sanitized = sanitizeCrudWidgetValue(item)
    if (sanitized !== undefined) result[key] = sanitized
  }
  return result
}

export function mergeCrudWidgetPayload(
  base: unknown,
  addition: unknown,
): CrudWidgetPayload | undefined {
  const merged: CrudWidgetPayload = {}
  if (isRecord(base)) {
    for (const [moduleId, modulePayload] of Object.entries(base)) {
      const sanitized = sanitizeCrudWidgetValue(modulePayload)
      if (isRecord(sanitized)) merged[moduleId] = sanitized
    }
  }
  if (isRecord(addition)) {
    for (const [moduleId, modulePayload] of Object.entries(addition)) {
      const sanitized = sanitizeCrudWidgetValue(modulePayload)
      if (!isRecord(sanitized)) continue
      merged[moduleId] = { ...(merged[moduleId] ?? {}), ...sanitized }
    }
  }
  return Object.keys(merged).length ? merged : undefined
}

export function buildCrudWidgetPayload(
  widgets: readonly { moduleId: string; fields?: readonly { id: string }[] }[],
  values: Record<string, unknown>,
  excludedFieldIds: ReadonlySet<string> = new Set(),
): CrudWidgetPayload | undefined {
  const payload: CrudWidgetPayload = {}
  for (const widget of widgets) {
    const fields = widget.fields ?? []
    for (const field of fields) {
      if (excludedFieldIds.has(field.id)) continue
      const value = sanitizeCrudWidgetValue(values[field.id])
      if (value === undefined) continue
      payload[widget.moduleId] = {
        ...(payload[widget.moduleId] ?? {}),
        [field.id]: value,
      }
    }
  }
  return Object.keys(payload).length ? payload : undefined
}

export function stripCrudWidgetPayload(body: Record<string, unknown>): Record<string, unknown> {
  const { [CRUD_WIDGET_PAYLOAD_KEY]: _widgetPayload, ...entityBody } = body
  return entityBody
}

export function addCrudWidgetPayload(
  body: Record<string, unknown>,
  widgetPayload: unknown,
): Record<string, unknown> {
  const merged = mergeCrudWidgetPayload(body[CRUD_WIDGET_PAYLOAD_KEY], widgetPayload)
  return merged ? { ...body, [CRUD_WIDGET_PAYLOAD_KEY]: merged } : body
}
