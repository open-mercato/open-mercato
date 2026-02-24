import { generateObject } from 'ai'
import { z } from 'zod'
import {
  resolveOpenCodeModel,
  resolveOpenCodeProviderApiKey,
} from '@open-mercato/shared/lib/ai/opencode-provider'
import { createStructuredModel, resolveExtractionProviderId, withTimeout } from './llmProvider'

const LANGUAGE_NAMES: Record<string, string> = { en: 'English', de: 'German', es: 'Spanish', pl: 'Polish' }

const translationOutputSchema = z.object({
  summary: z.string(),
  actions: z.record(z.string(), z.string()),
})

export async function translateProposalContent(input: {
  summary: string
  actionDescriptions: Record<string, string>
  sourceLanguage: string
  targetLocale: string
}): Promise<{ summary: string; actions: Record<string, string> }> {
  const providerId = resolveExtractionProviderId()
  const apiKey = resolveOpenCodeProviderApiKey(providerId)
  if (!apiKey) {
    throw new Error(`Missing API key for provider "${providerId}"`)
  }

  const modelConfig = resolveOpenCodeModel(providerId, {
    overrideModel: process.env.INBOX_OPS_LLM_MODEL,
  })
  const model = await createStructuredModel(providerId, apiKey, modelConfig.modelId)

  const sourceLang = LANGUAGE_NAMES[input.sourceLanguage] || input.sourceLanguage
  const targetLang = LANGUAGE_NAMES[input.targetLocale] || input.targetLocale

  const timeoutMs = parseInt(process.env.INBOX_OPS_TRANSLATION_TIMEOUT_MS || '30000', 10)

  const result = await withTimeout(
    generateObject({
      model,
      schema: translationOutputSchema,
      system: `You are a professional translator. Translate the provided content from ${sourceLang} to ${targetLang}. Preserve proper nouns, numbers, dates, currencies, product names, and company names exactly as they appear. Maintain the same tone and meaning.`,
      prompt: JSON.stringify({
        summary: input.summary,
        actions: input.actionDescriptions,
      }),
      temperature: 0,
    }),
    timeoutMs,
    `Translation timed out after ${timeoutMs}ms`,
  )

  return result.object
}
