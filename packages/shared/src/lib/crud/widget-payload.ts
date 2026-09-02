import {
  sanitizeExtensionPayload,
  type ParsedExtensionPayload,
} from '../umes/extension-payload'

export function buildCrudWidgetPayload(
  widgets: readonly { moduleId: string; fields?: readonly { id: string }[] }[],
  values: Record<string, unknown>,
  excludedFieldIds: ReadonlySet<string> = new Set(),
): ParsedExtensionPayload | undefined {
  const payload = Object.create(null) as ParsedExtensionPayload
  for (const widget of widgets) {
    const fields = widget.fields ?? []
    for (const field of fields) {
      if (excludedFieldIds.has(field.id)) continue
      const sanitized = sanitizeExtensionPayload({ [widget.moduleId]: { [field.id]: values[field.id] } })
      const modulePayload = sanitized?.[widget.moduleId]
      if (!modulePayload || Object.keys(modulePayload).length === 0) continue
      payload[widget.moduleId] = { ...(payload[widget.moduleId] ?? {}), ...modulePayload }
    }
  }
  return Object.keys(payload).length ? { ...payload } : undefined
}
