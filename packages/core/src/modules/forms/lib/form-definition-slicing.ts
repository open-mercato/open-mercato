type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function sliceFormDefinition(
  schema: JsonRecord,
  uiSchema: JsonRecord,
  visibleFieldKeys: ReadonlySet<string>,
): { schema: JsonRecord; uiSchema: JsonRecord } {
  const sourceProperties = isRecord(schema.properties) ? schema.properties : {}
  const propertyKeys = new Set(Object.keys(sourceProperties))
  const properties = Object.fromEntries(
    Object.entries(sourceProperties).filter(([fieldKey]) => visibleFieldKeys.has(fieldKey)),
  )
  const required = Array.isArray(schema.required)
    ? schema.required.filter(
        (fieldKey): fieldKey is string =>
          typeof fieldKey === 'string' && visibleFieldKeys.has(fieldKey),
      )
    : undefined
  const sections = Array.isArray(schema['x-om-sections'])
    ? schema['x-om-sections']
        .filter(isRecord)
        .map((section) => ({
          ...section,
          fieldKeys: Array.isArray(section.fieldKeys)
            ? section.fieldKeys.filter(
                (fieldKey): fieldKey is string =>
                  typeof fieldKey === 'string' && visibleFieldKeys.has(fieldKey),
              )
            : [],
        }))
        .filter((section) => section.fieldKeys.length > 0)
    : undefined
  const slicedSchema: JsonRecord = { ...schema, properties }
  if (required !== undefined) slicedSchema.required = required
  if (sections !== undefined) slicedSchema['x-om-sections'] = sections

  const slicedUiSchema = Object.fromEntries(
    Object.entries(uiSchema).filter(
      ([key]) => !propertyKeys.has(key) || visibleFieldKeys.has(key),
    ),
  )
  const order = slicedUiSchema['ui:order']
  if (Array.isArray(order)) {
    slicedUiSchema['ui:order'] = order.filter(
      (key) => key === '*' || (typeof key === 'string' && visibleFieldKeys.has(key)),
    )
  }

  return { schema: slicedSchema, uiSchema: slicedUiSchema }
}
