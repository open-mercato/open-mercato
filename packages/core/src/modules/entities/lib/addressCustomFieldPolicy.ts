export const CUSTOMER_ADDRESS_FIELD_HOST = 'customers:customer_address'
export const SALES_ADDRESS_FIELD_HOST = 'sales:sales_document_address'

const reservedAddressKeys = new Set([
  'id', 'entityid', 'customerid', 'customerentityid', 'customeraddressid', 'documentid', 'documentkind',
  'orderid', 'quoteid', 'tenantid', 'organizationid', 'createdat', 'updatedat', 'deletedat', 'isactive',
  'name', 'label', 'purpose', 'companyname', 'recipientname', 'addressline1', 'addressline2', 'buildingnumber',
  'flatnumber', 'city', 'region', 'postalcode', 'country', 'latitude', 'longitude', 'isprimary', 'phone', 'taxid',
  'taxidtype', 'customvalues', 'addresscustomvalues', 'customfields', 'constructor', 'prototype', 'proto',
])

export function isAddressCustomFieldHost(entityId: string): boolean {
  return entityId === CUSTOMER_ADDRESS_FIELD_HOST || entityId === SALES_ADDRESS_FIELD_HOST
}

export function isReservedAddressCustomFieldKey(key: string): boolean {
  return reservedAddressKeys.has(key.replace(/[_-]/g, '').toLowerCase())
}

export function isSupportedAddressCustomField(key: string, kind: string): boolean {
  return !isReservedAddressCustomFieldKey(key) && kind !== 'attachment'
}

export function acceptsAddressCustomFieldValue(
  kind: string,
  config: { multi?: unknown; options?: unknown },
  value: unknown,
): boolean {
  if (value == null) return true
  if (Array.isArray(value) && config.multi !== true) return false
  const values = Array.isArray(value) ? value : [value]
  const options = Array.isArray(config.options)
    ? config.options.map((option: unknown) => (
      option && typeof option === 'object' && 'value' in option ? option.value : option
    ))
    : []
  return values.every((entry) => {
    if (kind === 'boolean') return typeof entry === 'boolean'
    if (kind === 'integer' || kind === 'float') {
      if (typeof entry !== 'number' && (typeof entry !== 'string' || entry.trim() === '')) return false
      const number = Number(entry)
      return kind === 'integer' ? Number.isSafeInteger(number) : Number.isFinite(number)
    }
    if (kind === 'select' && options.length) {
      return options.some((option: unknown) => String(option) === String(entry))
    }
    if (kind === 'date' || kind === 'datetime') return typeof entry === 'string' && Number.isFinite(Date.parse(entry))
    if (kind === 'text' || kind === 'multiline' || kind === 'phone') return typeof entry === 'string'
    return typeof entry === 'string' || typeof entry === 'number'
  })
}

export function isAddressValuesIndexField(entityType: string | null | undefined, field: string): boolean {
  const lowerField = field.toLowerCase()
  const normalizedField = lowerField.split(':').at(-1)?.replace(/_/g, '')
  if (entityType && isAddressCustomFieldHost(entityType)) {
    return normalizedField === 'customvalues' || lowerField.startsWith('cf:') || lowerField.startsWith('cf_')
  }
  return (entityType === 'sales:sales_order' || entityType === 'sales:sales_quote') && normalizedField === 'addresscustomvalues'
}
