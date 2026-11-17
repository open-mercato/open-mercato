import type { AddressEditorDraft } from '@open-mercato/core/modules/customers/components/AddressEditor'

export function normalizeAddressDraft(
  draft?: AddressEditorDraft | null,
): Record<string, unknown> | null {
  if (!draft) return null
  const normalized: Record<string, unknown> = {}
  const assign = (key: keyof AddressEditorDraft, target: string) => {
    const value = draft[key]
    if (typeof value === 'string' && value.trim().length) normalized[target] = value.trim()
    if (typeof value === 'boolean') normalized[target] = value
  }
  assign('name', 'name')
  assign('purpose', 'purpose')
  assign('companyName', 'companyName')
  assign('addressLine1', 'addressLine1')
  assign('addressLine2', 'addressLine2')
  assign('buildingNumber', 'buildingNumber')
  assign('flatNumber', 'flatNumber')
  assign('city', 'city')
  assign('region', 'region')
  assign('postalCode', 'postalCode')
  assign('country', 'country')
  assign('taxId', 'taxId')
  assign('taxIdType', 'taxIdType')
  assign('phone', 'phone')
  assign('isPrimary', 'isPrimary')
  return Object.keys(normalized).length ? normalized : null
}
