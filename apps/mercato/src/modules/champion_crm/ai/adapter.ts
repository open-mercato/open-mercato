export type ChampionCrmAiLeadContext = {
  leadId: string
  contactId?: string | null
  tenantId: string
  organizationId: string
}

export type ChampionCrmAiSuggestion = {
  title: string
  body?: string
  confidence?: number
  metadata?: Record<string, unknown>
}

export type ChampionCrmAiAdapter = {
  suggestQualificationNextStep(context: ChampionCrmAiLeadContext): Promise<ChampionCrmAiSuggestion | null>
}

export type ChampionCrmAiAdapterResolver = () => ChampionCrmAiAdapter | null

export const resolveChampionCrmAiAdapter: ChampionCrmAiAdapterResolver = () => null

