import type { EntityManager } from '@mikro-orm/postgresql'
import type { EventBus } from '@open-mercato/events/types'
import { generateObject } from 'ai'
import {
  resolveFirstConfiguredOpenCodeProvider,
  resolveOpenCodeModel,
  resolveOpenCodeProviderApiKey,
  resolveOpenCodeProviderId,
  type OpenCodeProviderId,
} from '@open-mercato/shared/lib/ai/opencode-provider'
import { InboxEmail, InboxProposal, InboxProposalAction, InboxDiscrepancy } from '../data/entities'
import type { ExtractedParticipant } from '../data/entities'
import { extractionOutputSchema } from '../data/validators'
import { matchContacts } from '../lib/contactMatcher'
import { buildExtractionSystemPrompt, buildExtractionUserPrompt, REQUIRED_FEATURES_MAP } from '../lib/extractionPrompt'
import { fetchCatalogProductsForExtraction } from '../lib/catalogLookup'
import { validatePrices } from '../lib/priceValidator'

export const metadata = {
  event: 'inbox_ops.email.received',
  persistent: true,
  id: 'inbox_ops:extraction-worker',
}

interface EmailReceivedPayload {
  emailId: string
  tenantId: string
  organizationId: string | null
  forwardedByAddress: string
  subject: string
}

interface ResolverContext {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(payload: EmailReceivedPayload, ctx: ResolverContext) {
  const em = (ctx.resolve('em') as EntityManager).fork()

  const email = await em.findOne(InboxEmail, { id: payload.emailId })
  if (!email) {
    console.error(`[inbox_ops:extraction-worker] Email not found: ${payload.emailId}`)
    return
  }

  if (email.status !== 'received') {
    return
  }

  email.status = 'processing'
  await em.flush()

  try {
    const scope = {
      tenantId: email.tenantId,
      organizationId: email.organizationId,
    }

    // Step 1: Parse email thread for clean text
    const cleanedText = email.cleanedText || ''
    if (!cleanedText.trim()) {
      email.status = 'failed'
      email.processingError = 'No text content found in email'
      await em.flush()
      return
    }

    // Step 2: Match contacts from thread participants
    const threadParticipants = extractParticipantsFromThread(email)
    const contactMatches = await matchContacts(em, threadParticipants, scope)

    // Step 2b: Fetch catalog products for LLM context
    const catalogProducts = await fetchCatalogProductsForExtraction(em, scope)

    // Step 3: Call LLM for extraction
    const maxTextSize = parseInt(process.env.INBOX_OPS_MAX_TEXT_SIZE || '204800', 10)
    const truncatedText = cleanedText.slice(0, maxTextSize)

    const systemPrompt = buildExtractionSystemPrompt(contactMatches, catalogProducts, undefined)
    const userPrompt = buildExtractionUserPrompt(truncatedText)

    let extractionResult: ReturnType<typeof extractionOutputSchema.parse>
    let tokensUsed = 0
    let modelUsed = ''

    try {
      const timeoutMsRaw = Number.parseInt(process.env.INBOX_OPS_LLM_TIMEOUT_MS || '90000', 10)
      const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : 90000
      const extraction = await runExtractionWithConfiguredProvider({
        systemPrompt,
        userPrompt,
        modelOverride: process.env.INBOX_OPS_LLM_MODEL,
        timeoutMs,
      })
      extractionResult = extraction.object
      tokensUsed = extraction.totalTokens
      modelUsed = extraction.modelWithProvider
    } catch (llmError) {
      email.status = 'failed'
      email.processingError = `LLM extraction failed: ${llmError instanceof Error ? llmError.message : String(llmError)}`
      await em.flush()

      try {
        const eventBus = ctx.resolve('eventBus') as EventBus | null
        if (eventBus) {
          await eventBus.emit('inbox_ops.email.failed', {
            emailId: email.id,
            tenantId: email.tenantId,
            organizationId: email.organizationId,
            error: email.processingError,
          })
        }
      } catch (eventError) {
        console.error('[inbox_ops:extraction-worker] Failed to emit email.failed event:', eventError)
      }

      return
    }

    const confidenceThresholdRaw = Number.parseFloat(process.env.INBOX_OPS_CONFIDENCE_THRESHOLD || '0.5')
    const confidenceThreshold = Number.isFinite(confidenceThresholdRaw)
      ? Math.min(Math.max(confidenceThresholdRaw, 0), 1)
      : 0.5
    const requiresReview = extractionResult.confidence < confidenceThreshold

    // Step 4: Validate prices for order/quote actions
    const orderActions = extractionResult.proposedActions
      .map((action, index) => ({ ...action, index }))
      .filter((a) => a.actionType === 'create_order' || a.actionType === 'create_quote')

    const priceDiscrepancies = await validatePrices(em, orderActions, scope)

    // Step 5: Merge contact match data into participants
    const enrichedParticipants: ExtractedParticipant[] = extractionResult.participants.map((p) => {
      const match = contactMatches.find(
        (m) => m.participant.email.toLowerCase() === p.email.toLowerCase(),
      )
      return {
        ...p,
        matchedContactId: match?.match?.contactId || null,
        matchedContactType: match?.match?.contactType || null,
        matchConfidence: match?.match?.confidence,
      }
    })

    // Step 6: Detect partial forward
    const possiblyIncomplete = extractionResult.possiblyIncomplete || detectPartialForward(email)

    // Step 7: Create proposal + actions + discrepancies atomically
    const proposal = em.create(InboxProposal, {
      inboxEmailId: email.id,
      summary: extractionResult.summary,
      participants: enrichedParticipants,
      confidence: String(extractionResult.confidence.toFixed(2)),
      detectedLanguage: extractionResult.detectedLanguage || email.detectedLanguage,
      status: 'pending',
      possiblyIncomplete,
      llmModel: modelUsed,
      llmTokensUsed: tokensUsed,
      organizationId: email.organizationId,
      tenantId: email.tenantId,
    })
    em.persist(proposal)

    // Create actions
    const allActions = [
      ...extractionResult.proposedActions.map((action, index) =>
        em.create(InboxProposalAction, {
          proposalId: proposal.id,
          sortOrder: index,
          actionType: action.actionType,
          description: action.description,
          payload: action.payload,
          status: 'pending',
          confidence: String(action.confidence.toFixed(2)),
          requiredFeature: action.requiredFeature || REQUIRED_FEATURES_MAP[action.actionType] || null,
          organizationId: email.organizationId,
          tenantId: email.tenantId,
        }),
      ),
      ...extractionResult.draftReplies.map((reply, index) =>
        em.create(InboxProposalAction, {
          proposalId: proposal.id,
          sortOrder: extractionResult.proposedActions.length + index,
          actionType: 'draft_reply',
          description: `Draft reply to ${reply.toName || reply.to}: ${reply.subject}`,
          payload: {
            to: reply.to,
            toName: reply.toName,
            subject: reply.subject,
            body: reply.body,
            context: reply.context,
            replyTo: email.replyTo,
            inReplyToMessageId: email.messageId,
            references: email.emailReferences,
          },
          status: 'pending',
          confidence: String(extractionResult.confidence.toFixed(2)),
          requiredFeature: 'inbox_ops.replies.send',
          organizationId: email.organizationId,
          tenantId: email.tenantId,
        }),
      ),
    ]
    allActions.forEach((a) => em.persist(a))

    // Create discrepancies from LLM extraction
    const allDiscrepancies = [
      ...extractionResult.discrepancies.map((d) =>
        em.create(InboxDiscrepancy, {
          proposalId: proposal.id,
          actionId: d.actionIndex !== undefined && allActions[d.actionIndex]
            ? allActions[d.actionIndex].id
            : null,
          type: d.type,
          severity: d.severity,
          description: d.description,
          expectedValue: d.expectedValue || null,
          foundValue: d.foundValue || null,
          resolved: false,
          organizationId: email.organizationId,
          tenantId: email.tenantId,
        }),
      ),
      ...priceDiscrepancies.map((d) =>
        em.create(InboxDiscrepancy, {
          proposalId: proposal.id,
          actionId: d.actionIndex !== undefined && allActions[d.actionIndex]
            ? allActions[d.actionIndex].id
            : null,
          type: d.type,
          severity: d.severity,
          description: d.description,
          expectedValue: d.expectedValue || null,
          foundValue: d.foundValue || null,
          resolved: false,
          organizationId: email.organizationId,
          tenantId: email.tenantId,
        }),
      ),
    ]

    // Flag unmatched contacts as discrepancies
    for (const match of contactMatches) {
      if (!match.match && match.participant.email) {
        const disc = em.create(InboxDiscrepancy, {
          proposalId: proposal.id,
          type: 'unknown_contact',
          severity: 'warning',
          description: `No matching contact found for ${match.participant.name} (${match.participant.email})`,
          foundValue: match.participant.email,
          resolved: false,
          organizationId: email.organizationId,
          tenantId: email.tenantId,
        })
        allDiscrepancies.push(disc)
      }
    }

    allDiscrepancies.forEach((d) => em.persist(d))

    // Step 8: Update email status
    email.status = requiresReview ? 'needs_review' : 'processed'
    email.detectedLanguage = extractionResult.detectedLanguage || email.detectedLanguage

    await em.flush()

    // Step 9: Emit events
    try {
      const eventBus = ctx.resolve('eventBus') as EventBus | null
      if (eventBus) {
        await eventBus.emit('inbox_ops.email.processed', {
          emailId: email.id,
          tenantId: email.tenantId,
          organizationId: email.organizationId,
        })

        await eventBus.emit('inbox_ops.proposal.created', {
          proposalId: proposal.id,
          emailId: email.id,
          tenantId: email.tenantId,
          organizationId: email.organizationId,
          actionCount: allActions.length,
          discrepancyCount: allDiscrepancies.length,
          confidence: proposal.confidence,
          summary: proposal.summary,
        })
      }
    } catch (eventError) {
      console.error('[inbox_ops:extraction-worker] Failed to emit events:', eventError)
    }
  } catch (err) {
    email.status = 'failed'
    email.processingError = err instanceof Error ? err.message : String(err)
    await em.flush()

    try {
      const eventBus = ctx.resolve('eventBus') as EventBus | null
      if (eventBus) {
        await eventBus.emit('inbox_ops.email.failed', {
          emailId: email.id,
          tenantId: email.tenantId,
          organizationId: email.organizationId,
          error: email.processingError,
        })
      }
    } catch (eventError) {
      console.error('[inbox_ops:extraction-worker] Failed to emit email.failed event:', eventError)
    }

    console.error('[inbox_ops:extraction-worker] Extraction failed:', err)
  }
}

function extractParticipantsFromThread(
  email: InboxEmail,
): { name: string; email: string; role: string }[] {
  const seen = new Set<string>()
  const participants: { name: string; email: string; role: string }[] = []

  const addParticipant = (name: string, email: string, role: string) => {
    const key = email.toLowerCase()
    if (!key || seen.has(key)) return
    seen.add(key)
    participants.push({ name, email: key, role })
  }

  if (email.threadMessages) {
    for (const msg of email.threadMessages) {
      if (msg.from?.email) {
        addParticipant(msg.from.name || '', msg.from.email, 'other')
      }
      if (msg.to) {
        for (const to of msg.to) {
          addParticipant(to.name || '', to.email, 'other')
        }
      }
      if (msg.cc) {
        for (const cc of msg.cc) {
          addParticipant(cc.name || '', cc.email, 'other')
        }
      }
    }
  }

  if (email.forwardedByAddress) {
    addParticipant(email.forwardedByName || '', email.forwardedByAddress, 'seller')
  }

  return participants
}

function detectPartialForward(email: InboxEmail): boolean {
  const subject = email.subject || ''
  const hasReOrFw = /^(RE|FW|Fwd):/i.test(subject)
  const messageCount = email.threadMessages?.length || 0
  return hasReOrFw && messageCount < 2
}

async function runExtractionWithConfiguredProvider(input: {
  systemPrompt: string
  userPrompt: string
  modelOverride?: string | null
  timeoutMs: number
}): Promise<{
  object: ReturnType<typeof extractionOutputSchema.parse>
  totalTokens: number
  modelWithProvider: string
}> {
  const providerId = resolveExtractionProviderId()
  const apiKey = resolveOpenCodeProviderApiKey(providerId)
  if (!apiKey) {
    throw new Error(`Missing API key for provider "${providerId}"`)
  }

  const modelConfig = resolveOpenCodeModel(providerId, {
    overrideModel: input.modelOverride,
  })
  const model = await createStructuredModel(providerId, apiKey, modelConfig.modelId)

  const result = await withTimeout(
    generateObject({
      model,
      schema: extractionOutputSchema,
      system: input.systemPrompt,
      prompt: input.userPrompt,
      temperature: 0,
    }),
    input.timeoutMs,
    `LLM extraction timed out after ${input.timeoutMs}ms`,
  )

  return {
    object: result.object,
    totalTokens: Number(result.usage?.totalTokens ?? 0) || 0,
    modelWithProvider: modelConfig.modelWithProvider,
  }
}

function resolveExtractionProviderId(): OpenCodeProviderId {
  const configuredProvider = process.env.OPENCODE_PROVIDER
  if (configuredProvider && configuredProvider.trim().length > 0) {
    return resolveOpenCodeProviderId(configuredProvider)
  }

  const firstConfiguredProvider = resolveFirstConfiguredOpenCodeProvider()
  if (firstConfiguredProvider) {
    return firstConfiguredProvider
  }

  return resolveOpenCodeProviderId(undefined)
}

async function createStructuredModel(
  providerId: OpenCodeProviderId,
  apiKey: string,
  modelId: string,
): Promise<Parameters<typeof generateObject>[0]['model']> {
  switch (providerId) {
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic')
      return createAnthropic({ apiKey })(modelId) as unknown as Parameters<typeof generateObject>[0]['model']
    }
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      return createOpenAI({ apiKey })(modelId) as unknown as Parameters<typeof generateObject>[0]['model']
    }
    case 'google': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
      return createGoogleGenerativeAI({ apiKey })(modelId) as unknown as Parameters<typeof generateObject>[0]['model']
    }
    default:
      throw new Error(`Unsupported provider: ${providerId}`)
  }
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
  })

  try {
    return await Promise.race([operation, timeoutPromise])
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
  }
}
