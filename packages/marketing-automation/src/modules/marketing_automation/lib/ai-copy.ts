import type { AwilixContainer } from 'awilix'
import { withTimeout } from '@open-mercato/shared/lib/http/fetchWithTimeout'
import {
  draftSystemPrompt,
  draftUserPrompt,
  parseDraftedCopy,
  type DraftBriefing,
  type DraftedCopy,
} from './engine/copy-draft.js'

/**
 * Drafting campaign copy with a model — at AUTHORING time, once, for a human to edit.
 *
 * **Not per recipient at send time, which is what the source module did.** Three reasons, in order of how
 * much they matter: copy nobody read would reach customers, and this module's standing rule is that AI may
 * author and only a human may publish; the cost would scale with the audience, so a campaign to fifty
 * thousand people would be fifty thousand generations of nearly the same paragraph; and a model that is
 * slow or down at send time would either block the journey or silently skip a message. Personalisation per
 * customer is what interpolation and the recommendation block already do, deterministically and for free.
 */

const MODULE_ID = 'marketing_automation'

/** The config key holding how this shop writes, so every draft sounds like the same brand. */
export const BRAND_VOICE_CONFIG = 'brandVoice'

/** Beyond this an author has given up waiting and pressed the button again. */
const DRAFT_TIMEOUT_MS = 45_000

export class CopyDraftUnavailableError extends Error {
  constructor(message = '[internal] no AI model is configured for marketing copy') {
    super(message)
    this.name = 'CopyDraftUnavailableError'
  }
}

export class CopyDraftUnusableError extends Error {
  constructor(message = '[internal] the model did not return usable copy') {
    super(message)
    this.name = 'CopyDraftUnusableError'
  }
}

function isModelFactoryError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  return (error as { name?: unknown }).name === 'AiModelFactoryError'
}

/**
 * Both AI packages are OPTIONAL peers, and both are loaded at call time rather than imported.
 *
 * A trimmed installation that never shipped `@open-mercato/ai-assistant` must still dispatch campaigns; a
 * static import would make the whole module fail to load for the sake of one button. Loading here means the
 * only consequence of their absence is that this endpoint answers "not configured", which it already had to
 * answer for an installation with the package and no provider key.
 *
 * The shapes are declared locally because the packages cannot be relied on to be resolvable; the cast is
 * confined to these two functions.
 */
type GenerateTextLike = (input: {
  model: unknown
  system: string
  prompt: string
  temperature?: number
  abortSignal?: AbortSignal
}) => Promise<{ text?: string }>

async function loadGenerateText(): Promise<GenerateTextLike> {
  try {
    const sdk = await import('ai')
    const generate = (sdk as { generateText?: unknown }).generateText
    if (typeof generate !== 'function') throw new CopyDraftUnavailableError()
    return generate as GenerateTextLike
  } catch (error) {
    if (error instanceof CopyDraftUnavailableError) throw error
    throw new CopyDraftUnavailableError()
  }
}

/**
 * Resolves the model through the platform factory, so provider choice, tenant allowlists and env
 * precedence are somebody else's problem and stay consistent with every other AI caller.
 */
async function resolveModel(container: AwilixContainer): Promise<unknown> {
  let createModelFactory: (container: AwilixContainer) => {
    resolveModel(input: { moduleId: string }): { model: unknown }
  }
  try {
    const factoryModule = await import('@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory')
    const create = (factoryModule as { createModelFactory?: unknown }).createModelFactory
    if (typeof create !== 'function') throw new CopyDraftUnavailableError()
    createModelFactory = create as typeof createModelFactory
  } catch (error) {
    if (error instanceof CopyDraftUnavailableError) throw error
    throw new CopyDraftUnavailableError()
  }

  try {
    return createModelFactory(container).resolveModel({ moduleId: MODULE_ID }).model
  } catch (error) {
    if (isModelFactoryError(error)) throw new CopyDraftUnavailableError()
    throw error
  }
}

export async function draftCampaignCopy(
  container: AwilixContainer,
  briefing: DraftBriefing,
): Promise<DraftedCopy> {
  const [model, generateText] = await Promise.all([resolveModel(container), loadGenerateText()])

  const result = await withTimeout(
    (signal) => generateText({
      model,
      system: draftSystemPrompt(),
      prompt: draftUserPrompt(briefing),
      // Some variety is the point — an author who presses the button twice wants a second option, not the
      // same sentence again — but not so much that the brand voice stops being followed.
      temperature: 0.7,
      abortSignal: signal,
    }),
    DRAFT_TIMEOUT_MS,
    'marketing copy draft',
  )

  const copy = parseDraftedCopy(result.text ?? '')
  if (!copy) throw new CopyDraftUnusableError()
  return copy
}

type ModuleConfigLike = {
  getValue<T = unknown>(
    moduleId: string,
    name: string,
    options?: { defaultValue?: T | null; scope?: { tenantId?: string | null; organizationId?: string | null } },
  ): Promise<T | null>
}

/** The tenant's brand voice, or null. Scope inside the options object — see `lib/tiers.ts`. */
export async function loadBrandVoice(
  container: AwilixContainer,
  scope: { tenantId: string; organizationId: string },
): Promise<string | null> {
  let service: ModuleConfigLike
  try {
    service = container.resolve<ModuleConfigLike>('moduleConfigService')
  } catch {
    return null
  }
  try {
    const value = await service.getValue<unknown>(MODULE_ID, BRAND_VOICE_CONFIG, { scope })
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
  } catch {
    return null
  }
}
