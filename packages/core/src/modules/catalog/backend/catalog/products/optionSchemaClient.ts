import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

export type OptionSchemaRecord = {
  version?: number | null
  name?: string | null
  description?: string | null
  options?: OptionDefinitionRecord[]
}

export type OptionDefinitionRecord = {
  code?: string | null
  label?: string | null
  description?: string | null
  inputType?: string | null
  choices?: Array<{ code?: string | null; label?: string | null }>
}

export type OptionSchemaTemplateSummary = {
  id?: string
  name?: string | null
  code?: string | null
  description?: string | null
  schema?: OptionSchemaRecord | null
}

type OptionSchemaTemplateListResponse = {
  items?: OptionSchemaTemplateSummary[]
}

export async function fetchOptionSchemaTemplate(id: string): Promise<OptionSchemaTemplateSummary | null> {
  if (!id) return null
  try {
    const res = await apiCall<OptionSchemaTemplateListResponse>(
      `/api/catalog/option-schemas?id=${encodeURIComponent(id)}&page=1&pageSize=1`,
    )
    if (!res.ok) return null
    const record = Array.isArray(res.result?.items) ? res.result?.items?.[0] : null
    return record ?? null
  } catch (err) {
    console.error('catalog.option-schemas.fetch-one failed', err)
    return null
  }
}
