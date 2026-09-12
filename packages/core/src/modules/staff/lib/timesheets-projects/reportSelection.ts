export type ReportSelectionProject = {
  id: string
  name: string
  customerId: string | null
  customerName: string | null
  currencyCode: string | null
}

export type ReportSelectionBlockedReason =
  | 'empty'
  | 'missing_customer'
  | 'multiple_customers'
  | 'multiple_currencies'

export type ReportSelection =
  | {
      ok: true
      customerId: string
      customerName: string | null
      currencyCode: string | null
      projectIds: string[]
    }
  | {
      ok: false
      reason: ReportSelectionBlockedReason
      offenders: string[]
    }

/**
 * A customer report covers exactly one customer and exactly one currency
 * (screen 3 note 4, risk R2). The projects list therefore refuses to open a
 * report for a selection that spans customers or currencies, and names the
 * offenders so the user can fix the selection instead of guessing.
 */
export function resolveReportSelection(
  projects: readonly ReportSelectionProject[],
): ReportSelection {
  if (projects.length === 0) return { ok: false, reason: 'empty', offenders: [] }

  const withoutCustomer = projects.filter((project) => !project.customerId)
  if (withoutCustomer.length > 0) {
    return {
      ok: false,
      reason: 'missing_customer',
      offenders: withoutCustomer.map((project) => project.name),
    }
  }

  const customerNameById = new Map<string, string>()
  for (const project of projects) {
    if (!project.customerId) continue
    if (customerNameById.has(project.customerId)) continue
    customerNameById.set(project.customerId, project.customerName ?? project.customerId)
  }
  if (customerNameById.size > 1) {
    return {
      ok: false,
      reason: 'multiple_customers',
      offenders: Array.from(customerNameById.values()),
    }
  }

  const currencies = Array.from(
    new Set(
      projects
        .map((project) => project.currencyCode)
        .filter((code): code is string => typeof code === 'string' && code.length > 0),
    ),
  )
  if (currencies.length > 1) {
    return { ok: false, reason: 'multiple_currencies', offenders: currencies }
  }

  const [customerId] = Array.from(customerNameById.keys())
  return {
    ok: true,
    customerId,
    customerName: customerNameById.get(customerId) ?? null,
    currencyCode: currencies[0] ?? null,
    projectIds: projects.map((project) => project.id),
  }
}
