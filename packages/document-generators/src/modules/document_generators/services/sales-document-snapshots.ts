export interface CustomerSnapshot {
  contact?: {
    firstName?: string
    lastName?: string
  }
  customer?: {
    displayName?: string
    primaryEmail?: string
    personProfile?: {
      firstName?: string
      lastName?: string
    }
    companyProfile?: {
      legalName?: string
      brandName?: string
    }
  }
}

export interface BillingAddressSnapshot {
  addressLine1?: string
  addressLine2?: string | null
  city?: string | null
  region?: string | null
  postalCode?: string | null
  country?: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseSnapshot<T extends object>(
  value: string | Record<string, unknown> | null,
): T | undefined {
  if (!value) return undefined

  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      return isRecord(parsed) ? parsed as T : undefined
    } catch {
      return undefined
    }
  }

  return value as T
}

export function documentNumber(data: Record<string, unknown>): string | undefined {
  const document = data.document
  if (!isRecord(document)) return undefined
  return typeof document.number === 'string' ? document.number : undefined
}
