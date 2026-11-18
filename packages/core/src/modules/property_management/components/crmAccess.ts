export type CrmAccess = { people: boolean; companies: boolean }

export const NO_CRM_ACCESS: CrmAccess = { people: false, companies: false }

export function readCrmAccess(value: unknown): CrmAccess {
  if (!value || typeof value !== 'object') return NO_CRM_ACCESS
  const record = value as Record<string, unknown>
  return { people: record.people === true, companies: record.companies === true }
}

export function visibleCrmName(allowed: boolean, value: unknown): string | null {
  return allowed && typeof value === 'string' && value.trim().length > 0 ? value : null
}
