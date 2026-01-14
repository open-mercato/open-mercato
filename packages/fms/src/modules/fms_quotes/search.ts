import type {
  SearchModuleConfig,
  SearchBuildContext,
  SearchResultPresenter,
  SearchIndexSource,
} from '@open-mercato/shared/modules/search'

function pickString(...candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const trimmed = candidate.trim()
    if (trimmed.length > 0) return trimmed
  }
  return null
}

function snippet(value: unknown, max = 140): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed.length) return undefined
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 3)}...`
}

function appendLine(lines: string[], label: string, value: unknown) {
  if (value === null || value === undefined) return
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (!text.trim()) return
  lines.push(`${label}: ${text}`)
}

function formatSubtitle(...parts: Array<unknown>): string | undefined {
  const text = parts
    .map((part) => (part === null || part === undefined ? '' : String(part)))
    .map((part) => part.trim())
    .filter(Boolean)
  if (text.length === 0) return undefined
  return text.join(' · ')
}

function buildQuoteUrl(id: string | null): string | null {
  if (!id) return null
  return `/backend/fms-quotes?id=${encodeURIComponent(id)}`
}

function buildOfferUrl(id: string | null): string | null {
  if (!id) return null
  return `/backend/fms-quotes/offers?id=${encodeURIComponent(id)}`
}

function formatRoute(origins: string[], destinations: string[]): string | null {
  if (origins.length === 0 && destinations.length === 0) return null
  const originStr = origins.join(', ')
  const destStr = destinations.join(', ')
  if (originStr && destStr) return `${originStr} → ${destStr}`
  if (originStr) return originStr
  if (destStr) return `→ ${destStr}`
  return null
}

function getPortCodes(ports: unknown): string[] {
  if (!Array.isArray(ports)) return []
  return ports
    .map((port) => {
      if (typeof port !== 'object' || port === null) return null
      const p = port as Record<string, unknown>
      return pickString(p.locode, p.code)
    })
    .filter((code): code is string => code !== null)
}

function formatStatus(status: unknown): string {
  if (typeof status !== 'string') return 'Unknown'
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function getNestedValue(obj: unknown, key: string): unknown {
  if (typeof obj !== 'object' || obj === null) return undefined
  return (obj as Record<string, unknown>)[key]
}

function buildQuotePresenter(
  record: Record<string, unknown>,
  customFields: Record<string, unknown>,
): SearchResultPresenter {
  const quoteNumber = pickString(
    record.quote_number,
    record.quoteNumber,
    customFields.quote_number,
  )

  // Client can be an object (populated relation) or null
  const client = record.client as Record<string, unknown> | null | undefined
  const clientName = client ? pickString(client.name, client.shortName) : null

  const title = quoteNumber ?? clientName ?? (record.id as string | undefined) ?? 'Quote'

  const status = formatStatus(record.status)

  // Origin/Destination ports are now arrays of objects (populated relations)
  const originCodes = getPortCodes(record.originPorts)
  const destCodes = getPortCodes(record.destinationPorts)
  const route = formatRoute(originCodes, destCodes)

  const direction = pickString(record.direction)

  return {
    title: String(title),
    subtitle: formatSubtitle(
      clientName !== title ? clientName : null,
      route,
      direction?.toUpperCase(),
      status,
    ),
    icon: 'file-text',
    badge: 'Quote',
  }
}

function buildOfferPresenter(
  record: Record<string, unknown>,
  customFields: Record<string, unknown>,
): SearchResultPresenter {
  const offerNumber = pickString(
    record.offer_number,
    record.offerNumber,
    customFields.offer_number,
  )
  const carrierName = pickString(record.carrier_name, record.carrierName)
  const title = offerNumber ?? (record.id as string | undefined) ?? 'Offer'

  const status = formatStatus(record.status)
  const version = record.version
  const versionLabel = typeof version === 'number' && version > 1 ? `v${version}` : null
  const contractType = pickString(record.contract_type, record.contractType)

  return {
    title: String(title),
    subtitle: formatSubtitle(carrierName, contractType?.toUpperCase(), versionLabel, status),
    icon: 'send',
    badge: 'Offer',
  }
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    // FMS Quote
    {
      entityId: 'fms_quotes:fms_quote',
      enabled: true,
      priority: 10,

      buildSource: async (ctx: SearchBuildContext): Promise<SearchIndexSource | null> => {
        const record = ctx.record
        const lines: string[] = []

        appendLine(lines, 'Quote Number', record.quote_number ?? record.quoteNumber)

        // Client relation
        const client = record.client as Record<string, unknown> | null | undefined
        if (client) {
          appendLine(lines, 'Client', client.name)
          appendLine(lines, 'Client Short', client.shortName)
        }

        appendLine(lines, 'Status', formatStatus(record.status))
        appendLine(lines, 'Direction', record.direction)

        // Origin ports (array of relations)
        const originPorts = record.originPorts as Array<Record<string, unknown>> | null | undefined
        if (Array.isArray(originPorts) && originPorts.length > 0) {
          const originCodes = originPorts.map(p => p.locode ?? p.code).filter(Boolean).join(', ')
          const originNames = originPorts.map(p => p.name).filter(Boolean).join(', ')
          const originCities = originPorts.map(p => p.city).filter(Boolean).join(', ')
          appendLine(lines, 'Origin Codes', originCodes)
          appendLine(lines, 'Origin Names', originNames)
          appendLine(lines, 'Origin Cities', originCities)
        }

        // Destination ports (array of relations)
        const destPorts = record.destinationPorts as Array<Record<string, unknown>> | null | undefined
        if (Array.isArray(destPorts) && destPorts.length > 0) {
          const destCodes = destPorts.map(p => p.locode ?? p.code).filter(Boolean).join(', ')
          const destNames = destPorts.map(p => p.name).filter(Boolean).join(', ')
          const destCities = destPorts.map(p => p.city).filter(Boolean).join(', ')
          appendLine(lines, 'Destination Codes', destCodes)
          appendLine(lines, 'Destination Names', destNames)
          appendLine(lines, 'Destination Cities', destCities)
        }

        appendLine(lines, 'Incoterm', record.incoterm)
        appendLine(lines, 'Cargo Type', record.cargo_type ?? record.cargoType)
        appendLine(lines, 'Notes', snippet(record.notes))

        if (!lines.length) return null

        const presenter = buildQuotePresenter(record, ctx.customFields)

        return {
          text: lines,
          presenter,
          checksumSource: {
            record: ctx.record,
            customFields: ctx.customFields,
          },
        }
      },

      formatResult: async (ctx: SearchBuildContext): Promise<SearchResultPresenter | null> => {
        return buildQuotePresenter(ctx.record, ctx.customFields)
      },

      resolveUrl: async (ctx: SearchBuildContext): Promise<string | null> => {
        const id = ctx.record.id as string | undefined
        return buildQuoteUrl(id ?? null)
      },

      fieldPolicy: {
        searchable: [
          'quote_number',
          'status',
          'direction',
          'incoterm',
          'cargo_type',
          'notes',
        ],
        hashOnly: [],
        excluded: ['valid_until', 'currency_code', 'container_count', 'client_id', 'origin_port_id', 'destination_port_id'],
      },
    },

    // FMS Offer
    {
      entityId: 'fms_quotes:fms_offer',
      enabled: true,
      priority: 9,

      buildSource: async (ctx: SearchBuildContext): Promise<SearchIndexSource | null> => {
        const record = ctx.record
        const lines: string[] = []

        appendLine(lines, 'Offer Number', record.offer_number ?? record.offerNumber)
        appendLine(lines, 'Carrier', record.carrier_name ?? record.carrierName)
        appendLine(lines, 'Status', formatStatus(record.status))
        appendLine(lines, 'Contract Type', record.contract_type ?? record.contractType)
        appendLine(lines, 'Version', record.version)
        appendLine(lines, 'Notes', snippet(record.notes))
        appendLine(lines, 'Customer Notes', snippet(record.customer_notes ?? record.customerNotes))

        if (!lines.length) return null

        const presenter = buildOfferPresenter(record, ctx.customFields)

        return {
          text: lines,
          presenter,
          checksumSource: {
            record: ctx.record,
            customFields: ctx.customFields,
          },
        }
      },

      formatResult: async (ctx: SearchBuildContext): Promise<SearchResultPresenter | null> => {
        return buildOfferPresenter(ctx.record, ctx.customFields)
      },

      resolveUrl: async (ctx: SearchBuildContext): Promise<string | null> => {
        const id = ctx.record.id as string | undefined
        return buildOfferUrl(id ?? null)
      },

      fieldPolicy: {
        searchable: [
          'offer_number',
          'carrier_name',
          'status',
          'contract_type',
          'notes',
          'customer_notes',
          'payment_terms',
          'special_terms',
        ],
        hashOnly: [],
        excluded: ['total_amount', 'currency_code', 'valid_until', 'superseded_by_id'],
      },
    },
  ],
}

export default searchConfig
export const config = searchConfig
