import {
  CONTRACT_VERSION,
  READY,
  defineAdapterModule,
  notReady,
  searchOk,
  type RawResult,
  type SearchAdapter,
  type SearchOutcome,
  type SearchRequest,
} from '@open-mercato/web-research'
import { z } from 'zod'
import { loadNativeSearchTool } from './nativeTools'
import { parseModelSummaries, stripSummaryBlock } from './parse'

export type ModelResolution = {
  readonly model: unknown
  readonly providerId: string
  readonly modelId: string
}

export type ModelResolver = () => Promise<ModelResolution> | ModelResolution

export type GenerateSource = { sourceType?: string; url?: string; title?: string }

export type GenerateResult = {
  readonly text?: string
  readonly sources?: readonly GenerateSource[]
}

export type GenerateFn = (input: {
  model: unknown
  tools: Record<string, unknown>
  prompt: string
  abortSignal?: AbortSignal
}) => Promise<GenerateResult>

export type LoadToolsFn = (providerId: string, maxUses: number) => Promise<Record<string, unknown> | null>

/**
 * `resolveModel`, `generate` and `loadTools` are host-supplied capabilities rather
 * than stored configuration, so they are validated structurally and merged in by
 * the registry at instantiation time. Keeping them in the same schema means the
 * adapter has one source of truth for what it needs, and `readiness()` can say so
 * plainly instead of failing deep inside a search.
 */
export const modelOptionsSchema = z.object({
  maxUses: z.number().int().min(1).max(10).optional(),
  resolveModel: z.custom<ModelResolver>((value) => typeof value === 'function').optional(),
  generate: z.custom<GenerateFn>((value) => typeof value === 'function').optional(),
  loadTools: z.custom<LoadToolsFn>((value) => typeof value === 'function').optional(),
})

export type ModelOptions = z.infer<typeof modelOptionsSchema>

const DEFAULT_MAX_USES = 3

/**
 * A spent quota, a bad key or a suspended account is a configuration problem, not
 * a transient one. Reporting it as `error` tells the scheduler to treat it as
 * bad luck and an operator to wait for it to pass, when the fix is billing or a
 * credential — so it maps to `unavailable`, which is what "this source cannot
 * currently work" means everywhere else in the contract.
 */
const NOT_CONFIGURED_MARKERS = [
  'exceeded your current quota',
  'insufficient_quota',
  'billing',
  'payment required',
  'invalid api key',
  'incorrect api key',
  'invalid_api_key',
  'authentication',
  'unauthorized',
  'account is not active',
]

/** Shown on the adapter's health row, so it must stay one short clause. */
const PROVIDER_CAVEATS: Readonly<Record<string, string>> = {
  azure: 'searches run via Grounding with Bing, billed separately and outside your geo boundary',
}

function isConfigurationFault(message: string): boolean {
  const haystack = message.toLowerCase()
  return NOT_CONFIGURED_MARKERS.some((marker) => haystack.includes(marker))
}

function buildPrompt(request: SearchRequest): string {
  const constraints: string[] = []
  if (request.site) constraints.push(`Restrict results to the site ${request.site}.`)
  if (request.freshness) constraints.push(`Prefer sources published within the last ${request.freshness}.`)
  if (request.locale) constraints.push(`Prefer sources written for the ${request.locale} locale.`)

  return [
    `Search the public web for: ${request.query}`,
    'Use the web_search tool, then answer in two parts.',
    '',
    'Part 1: a short prose answer citing the most relevant, authoritative sources.',
    '',
    `Part 2: a JSON array in a \`\`\`json code fence with up to ${request.limit} entries, each`,
    '{"url": "...", "title": "...", "summary": "one or two sentences on what this page says about the query"}.',
    'Only include URLs you actually retrieved. Write real summaries, not the page title again.',
    ...constraints,
  ].join('\n')
}

async function defaultGenerate(input: Parameters<GenerateFn>[0]): Promise<GenerateResult> {
  const { generateText } = await import('ai')
  type GenerateTextInput = Parameters<typeof generateText>[0]
  return (await generateText({
    model: input.model as GenerateTextInput['model'],
    tools: input.tools as GenerateTextInput['tools'],
    prompt: input.prompt,
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  })) as GenerateResult
}

export function createModelAdapter(options: ModelOptions): SearchAdapter {
  const maxUses = options.maxUses ?? DEFAULT_MAX_USES
  const resolveModel = options.resolveModel
  const generate = options.generate ?? defaultGenerate
  const loadTools = options.loadTools ?? loadNativeSearchTool

  return {
    id: 'model-native',
    kind: 'model',
    capabilities: {
      search: true,
      fetch: false,
      snippets: true,
      content: false,
      freshness: true,
      siteFilter: true,
      cost: 'llm-tokens',
    },
    /** `free` — resolves the configured model and its tool descriptors; no completion is issued. */
    probeCost: 'free' as const,
    readiness: () =>
      resolveModel ? READY : notReady('no model resolver was provided by the host application'),

    async search(request, context): Promise<SearchOutcome> {
      if (!resolveModel) {
        return { status: 'unavailable', reason: 'no model resolver was provided by the host application' }
      }

      let resolution: ModelResolution
      try {
        resolution = await resolveModel()
      } catch (error) {
        return {
          status: 'unavailable',
          reason: `could not resolve a model: ${error instanceof Error ? error.message : String(error)}`,
        }
      }

      const tools = await loadTools(resolution.providerId, maxUses)
      if (!tools) {
        return {
          status: 'unavailable',
          reason: `provider "${resolution.providerId}" has no native web search available`,
        }
      }

      let result: GenerateResult
      try {
        result = await generate({
          model: resolution.model,
          tools,
          prompt: buildPrompt(request),
          abortSignal: context.signal,
        })
      } catch (error) {
        if (context.signal.aborted) return { status: 'timeout', reason: 'model search was aborted' }
        const detail = error instanceof Error ? error.message : String(error)
        if (isConfigurationFault(detail)) {
          return { status: 'unavailable', reason: `model search is not usable: ${detail}` }
        }
        return { status: 'error', reason: `model search failed: ${detail}`, retriable: true }
      }

      const text = result.text ?? ''
      const summaries = new Map(parseModelSummaries(text).map((entry) => [entry.url, entry]))

      // Only URLs the search tool actually returned are trusted. The model's own
      // JSON is used solely to enrich those, never to introduce a link, because a
      // fabricated URL that reaches an agent is indistinguishable from a real one.
      const results: RawResult[] = []
      const seen = new Set<string>()
      for (const source of result.sources ?? []) {
        if (source.sourceType && source.sourceType !== 'url') continue
        const url = source.url
        if (!url || seen.has(url)) continue
        seen.add(url)
        const enrichment = summaries.get(url)
        results.push({
          url,
          title: enrichment?.title ?? source.title ?? null,
          snippet: enrichment?.summary ?? null,
        })
        if (results.length >= request.limit) break
      }

      const answer = stripSummaryBlock(text)
      context.report('ok', `model returned ${results.length} cited source(s)`, {
        resultCount: results.length,
      })

      return searchOk(results, answer)
    },

    async healthCheck() {
      if (!resolveModel) return { ok: false, detail: 'no model resolver was provided by the host application' }
      try {
        const resolution = await resolveModel()
        const tools = await loadTools(resolution.providerId, maxUses)
        if (!tools) {
          return { ok: false, detail: `provider "${resolution.providerId}" has no native web search` }
        }
        // Azure's native search is Grounding with Bing underneath: it is billed
        // separately and Microsoft states the Data Protection Addendum does not
        // cover it, so queries leave the tenant's compliance and geo boundary.
        // Anyone on Azure for data residency needs to see that, not discover it.
        const caveat = PROVIDER_CAVEATS[resolution.providerId]
        return {
          ok: true,
          detail: `${resolution.providerId}/${resolution.modelId}${caveat ? ` - ${caveat}` : ''}`,
        }
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}

export const modelAdapterModule = defineAdapterModule({
  id: 'model-native',
  kind: 'model',
  contractVersion: CONTRACT_VERSION,
  optionsSchema: modelOptionsSchema,
  createAdapter: createModelAdapter,
})
