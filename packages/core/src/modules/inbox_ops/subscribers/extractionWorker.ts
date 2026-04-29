import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { EntityClass } from '@mikro-orm/core'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { runWithCacheTenant } from '@open-mercato/cache'
import { InboxEmail, InboxProposal, InboxProposalAction, InboxDiscrepancy, InboxSettings, InboxSourceSubmission } from '../data/entities'
import type { ExtractedParticipant, InboxDiscrepancyType } from '../data/entities'
import type {
  CustomerEntity,
  CustomerAddress,
} from '@open-mercato/core/modules/customers/data/entities'
import type {
  CatalogProduct,
  CatalogProductPrice,
} from '@open-mercato/core/modules/catalog/data/entities'
import type { SalesOrder, SalesChannel } from '@open-mercato/core/modules/sales/data/entities'
import {
  extractionOutputSchema,
  inboxOpsSourcePromptHintsValidator,
  normalizedInboxOpsInputValidator,
} from '../data/validators'
import { matchContacts } from '../lib/contactMatcher'
import { buildExtractionSystemPrompt, buildExtractionUserPrompt } from '../lib/extractionPrompt'
import { REQUIRED_FEATURES_MAP } from '../lib/constants'
import { fetchCatalogProductsForExtraction } from '../lib/catalogLookup'
import { enrichOrderPayload } from '../lib/payloadEnrichment'
import { validatePrices } from '../lib/priceValidator'
import { runExtractionWithConfiguredProvider } from '../lib/llmProvider'
import { safeParsePayloadJson } from '../lib/validation'
import { emitInboxOpsEvent } from '../events'
import { createMessageRecordForEmail } from '../lib/messagesIntegration'
import { resolveCache, invalidateCountsCache } from '../lib/cache'
import { getInboxOpsSourceAdapter } from '../lib/source-registry'
import {
  applyNormalizedInputToSubmission,
  buildDescriptorFromSubmission,
} from '../lib/source-submission-service'
import type { InboxOpsSourceAdapterContext } from '@open-mercato/shared/modules/inbox-ops-sources'

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'

export const metadata = {
  event: 'inbox_ops.source_submission.received',
  persistent: true,
  id: 'inbox_ops:source-submission-worker',
}

interface SourceSubmissionReceivedPayload {
  sourceSubmissionId: string
  tenantId: string
  organizationId: string
}

interface ResolverContext extends InboxOpsSourceAdapterContext {
  resolve: <T = unknown>(name: string) => T
}

interface ExtractionEntityClasses {
  customerEntity?: EntityClass<CustomerEntity>
  catalogProduct?: EntityClass<CatalogProduct>
  catalogProductPrice?: EntityClass<CatalogProductPrice>
  salesOrder?: EntityClass<SalesOrder>
  salesChannel?: EntityClass<SalesChannel>
  customerAddress?: EntityClass<CustomerAddress>
}

interface DiscrepancyInput {
  actionIndex?: number
  type: InboxDiscrepancyType
  severity: 'warning' | 'error'
  description: string
  expectedValue?: string | null
  foundValue?: string | null
}

function tryResolve<T>(ctx: ResolverContext, name: string): T | undefined {
  try {
    return ctx.resolve<T>(name)
  } catch {
    console.debug(`[inbox_ops:source-worker] optional dependency "${name}" not available`)
    return undefined
  }
}

function resolveEntityClasses(ctx: ResolverContext): ExtractionEntityClasses {
  return {
    customerEntity: tryResolve(ctx, 'CustomerEntity'),
    catalogProduct: tryResolve(ctx, 'CatalogProduct'),
    catalogProductPrice: tryResolve(ctx, 'CatalogProductPrice'),
    salesOrder: tryResolve(ctx, 'SalesOrder'),
    salesChannel: tryResolve(ctx, 'SalesChannel'),
    customerAddress: tryResolve(ctx, 'CustomerAddress'),
  }
}

function createDiscrepancy(
  em: EntityManager,
  proposalId: string,
  allActions: { id: string }[],
  input: DiscrepancyInput,
  scope: { organizationId: string; tenantId: string },
) {
  return em.create(InboxDiscrepancy, {
    proposalId,
    actionId: input.actionIndex !== undefined && allActions[input.actionIndex]
      ? allActions[input.actionIndex].id
      : null,
    type: input.type,
    severity: input.severity,
    description: input.description,
    expectedValue: input.expectedValue || null,
    foundValue: input.foundValue || null,
    resolved: false,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
}

function extractSourceMetadata(input: Record<string, unknown> | undefined): {
  forwardedByAddress?: string
  forwardedByName?: string
  replyTo?: string
  messageId?: string
  references?: string[]
  isPartialForward?: boolean
} {
  const referencesRaw = input?.references
  return {
    forwardedByAddress: typeof input?.forwardedByAddress === 'string' ? input.forwardedByAddress : undefined,
    forwardedByName: typeof input?.forwardedByName === 'string' ? input.forwardedByName : undefined,
    replyTo: typeof input?.replyTo === 'string' ? input.replyTo : undefined,
    messageId: typeof input?.messageId === 'string' ? input.messageId : undefined,
    references: Array.isArray(referencesRaw)
      ? referencesRaw.filter((value): value is string => typeof value === 'string')
      : undefined,
    isPartialForward: typeof input?.isPartialForward === 'boolean' ? input.isPartialForward : undefined,
  }
}

export default async function handle(payload: SourceSubmissionReceivedPayload, ctx: ResolverContext) {
  const em = (ctx.resolve('em') as EntityManager).fork()
  const entityClasses = resolveEntityClasses(ctx)

  const claimed = await em.nativeUpdate(
    InboxSourceSubmission,
    { id: payload.sourceSubmissionId, status: 'received' },
    { status: 'processing', processingError: null },
  )
  if (claimed === 0) return

  const submission = await findOneWithDecryption(
    em,
    InboxSourceSubmission,
    {
      id: payload.sourceSubmissionId,
      organizationId: payload.organizationId,
      tenantId: payload.tenantId,
      deletedAt: null,
    },
    undefined,
    { tenantId: payload.tenantId, organizationId: payload.organizationId },
  )
  if (!submission) {
    console.error(`[inbox_ops:source-worker] Source submission not found: ${payload.sourceSubmissionId}`)
    return
  }

  const scope = {
    tenantId: submission.tenantId,
    organizationId: submission.organizationId,
  }

  const adapter = await getInboxOpsSourceAdapter(submission.sourceEntityType)
  if (!adapter) {
    submission.status = 'failed'
    submission.processingError = `No source adapter registered for ${submission.sourceEntityType}`
    await em.flush()
    return
  }

  const descriptor = buildDescriptorFromSubmission(submission)

  let legacyEmail: InboxEmail | null = null

  try {
    const loaded = await adapter.loadSource(descriptor, ctx)
    await adapter.assertReady?.(loaded, descriptor, ctx)

    const rawInput = await adapter.buildInput(loaded, descriptor, ctx)
    const normalizedInput = normalizedInboxOpsInputValidator.parse(rawInput)
    const rawPromptHints = await adapter.buildPromptHints?.(loaded, descriptor, ctx)
    const promptHints = rawPromptHints
      ? inboxOpsSourcePromptHintsValidator.parse(rawPromptHints)
      : null
    const sourceSnapshot = await adapter.buildSnapshot?.(loaded, descriptor, ctx)
    const adapterVersion = await adapter.getVersion?.(loaded, descriptor, ctx)
    const sourceVersion = normalizedInput.sourceVersion ?? adapterVersion ?? submission.sourceVersion ?? null

    applyNormalizedInputToSubmission(submission, normalizedInput)
    submission.sourceVersion = sourceVersion
    submission.sourceSnapshot = sourceSnapshot ?? submission.sourceSnapshot ?? null
    submission.processingError = null
    await em.flush()

    if (submission.legacyInboxEmailId) {
      if (submission.sourceEntityType === 'inbox_ops:inbox_email' && loaded instanceof InboxEmail) {
        legacyEmail = loaded
      } else {
        legacyEmail = await findOneWithDecryption(
          em,
          InboxEmail,
          {
            id: submission.legacyInboxEmailId,
            organizationId: submission.organizationId,
            tenantId: submission.tenantId,
            deletedAt: null,
          },
          undefined,
          scope,
        )
      }
    }

    const settings = await findOneWithDecryption(
      em,
      InboxSettings,
      { organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null },
      undefined,
      scope,
    )
    const workingLanguage = settings?.workingLanguage || 'en'

    const participantCandidates = normalizedInput.participants
      .filter((participant) => typeof participant.email === 'string' && participant.email.length > 0)
      .map((participant) => ({
        name: participant.displayName || participant.identifier,
        email: participant.email!,
        role: participant.role || 'other',
      }))

    const contactMatches = await matchContacts(
      em,
      participantCandidates,
      scope,
      entityClasses.customerEntity ? { customerEntityClass: entityClasses.customerEntity } : undefined,
    )

    const catalogProducts = await fetchCatalogProductsForExtraction(
      em,
      scope,
      entityClasses.catalogProduct && entityClasses.catalogProductPrice
        ? { catalogProductClass: entityClasses.catalogProduct, catalogProductPriceClass: entityClasses.catalogProductPrice }
        : undefined,
    )

    const systemPrompt = await buildExtractionSystemPrompt({
      matchedContacts: contactMatches,
      catalogProducts,
      workingLanguage,
      sourceInput: normalizedInput,
      promptHints,
    })
    const userPrompt = buildExtractionUserPrompt(normalizedInput)

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
      throw new Error(`LLM extraction failed: ${llmError instanceof Error ? llmError.message : String(llmError)}`)
    }

    const confidenceThresholdRaw = Number.parseFloat(process.env.INBOX_OPS_CONFIDENCE_THRESHOLD || '0.5')
    const confidenceThreshold = Number.isFinite(confidenceThresholdRaw)
      ? Math.min(Math.max(confidenceThresholdRaw, 0), 1)
      : 0.5
    const requiresReview = extractionResult.confidence < confidenceThreshold

    const orderActions = extractionResult.proposedActions
      .map((action, index) => ({
        ...action,
        payload: safeParsePayloadJson(action.payloadJson),
        index,
      }))
      .filter((action) => action.actionType === 'create_order' || action.actionType === 'create_quote')

    const priceDiscrepancies = await validatePrices(
      em,
      orderActions,
      scope,
      entityClasses.catalogProductPrice ? { catalogProductPriceClass: entityClasses.catalogProductPrice } : undefined,
    )

    const duplicateOrderDiscrepancies = await detectDuplicateOrders(
      em,
      orderActions,
      scope,
      entityClasses.salesOrder,
    )

    const headerEmails = new Set(contactMatches.map((match) => match.participant.email.toLowerCase()))
    const llmOnlyParticipants = extractionResult.participants
      .filter((participant) => participant.email && !headerEmails.has(participant.email.toLowerCase()))
      .map((participant) => ({
        name: participant.name,
        email: participant.email!,
        role: participant.role || 'other',
      }))

    if (llmOnlyParticipants.length > 0) {
      const llmContactMatches = await matchContacts(
        em,
        llmOnlyParticipants,
        scope,
        entityClasses.customerEntity ? { customerEntityClass: entityClasses.customerEntity } : undefined,
      )
      contactMatches.push(...llmContactMatches)
    }

    const enrichedParticipants: ExtractedParticipant[] = extractionResult.participants.map((participant) => {
      const participantEmail = participant.email.toLowerCase()
      const match = participantEmail
        ? contactMatches.find(
            (contactMatch) => contactMatch.participant.email.toLowerCase() === participantEmail,
          )
        : undefined

      return {
        ...participant,
        matchedContactId: match?.match?.contactId || null,
        matchedContactType: match?.match?.contactType || null,
        matchConfidence: match?.match?.confidence,
      }
    })

    const sourceMetadata = extractSourceMetadata(normalizedInput.sourceMetadata)
    const possiblyIncomplete = extractionResult.possiblyIncomplete || Boolean(sourceMetadata.isPartialForward)

    const senderEmail = sourceMetadata.forwardedByAddress
      || normalizedInput.participants.find((participant) => participant.email)?.email

    const enrichmentDiscrepancies: DiscrepancyInput[] = []
    for (const [actionIndex, action] of extractionResult.proposedActions.entries()) {
      if (action.actionType !== 'create_order' && action.actionType !== 'create_quote') continue

      const parsedPayload = safeParsePayloadJson(action.payloadJson)
      normalizeOrderPayloadFields(parsedPayload)

      const { payload: enriched, warnings } = await enrichOrderPayload(parsedPayload, {
        em,
        scope,
        contactMatches,
        catalogProducts,
        senderEmail: senderEmail || '',
        salesChannelClass: entityClasses.salesChannel,
        customerAddressClass: entityClasses.customerAddress,
      })

      action.payloadJson = JSON.stringify(enriched)

      for (const warning of warnings) {
        if (warning === 'no_channel_resolved') {
          enrichmentDiscrepancies.push({
            actionIndex,
            type: 'other',
            severity: 'error',
            description: 'inbox_ops.discrepancy.desc.no_channel',
          })
        } else if (warning === 'no_currency_resolved') {
          enrichmentDiscrepancies.push({
            actionIndex,
            type: 'currency_mismatch',
            severity: 'warning',
            description: 'inbox_ops.discrepancy.desc.no_currency',
          })
        }
      }
    }

    const participantEmailMap = buildParticipantEmailMap(contactMatches, extractionResult.participants)
    enrichCreateContactEmails(extractionResult.proposedActions, participantEmailMap)
    enrichDraftReplyTargets(extractionResult.draftReplies, participantEmailMap)

    const productNotFoundDiscrepancies: DiscrepancyInput[] = []
    const autoProductActions: { actionType: 'create_product'; description: string; confidence: number; requiredFeature: string; payloadJson: string }[] = []
    const seenProductNames = new Set<string>()

    for (const [actionIndex, action] of extractionResult.proposedActions.entries()) {
      if (action.actionType !== 'create_order' && action.actionType !== 'create_quote') continue
      const parsedPayload = safeParsePayloadJson(action.payloadJson)
      const lineItems = Array.isArray(parsedPayload.lineItems)
        ? (parsedPayload.lineItems as Record<string, unknown>[])
        : []

      for (const item of lineItems) {
        if (!item.productId) {
          const productName = typeof item.productName === 'string'
            ? item.productName
            : (typeof item.description === 'string' ? item.description : 'Unknown')
          productNotFoundDiscrepancies.push({
            actionIndex,
            type: 'product_not_found',
            severity: 'error',
            description: 'inbox_ops.discrepancy.desc.product_not_matched',
            foundValue: productName,
          })
          const nameKey = productName.toLowerCase().trim()
          if (nameKey && nameKey !== 'unknown' && !seenProductNames.has(nameKey)) {
            seenProductNames.add(nameKey)
            const sku = typeof item.sku === 'string' ? item.sku : undefined
            const unitPrice = typeof item.unitPrice === 'string' ? item.unitPrice : undefined
            const currencyCode = typeof parsedPayload.currencyCode === 'string' ? parsedPayload.currencyCode : undefined
            autoProductActions.push({
              actionType: 'create_product',
              description: 'inbox_ops.action.desc.create_product',
              confidence: 0.9,
              requiredFeature: REQUIRED_FEATURES_MAP.create_product,
              payloadJson: JSON.stringify({
                title: productName,
                ...(sku && { sku }),
                ...(unitPrice && { unitPrice }),
                ...(currencyCode && { currencyCode }),
                kind: 'product',
              }),
            })
          }
        }
      }
    }

    const proposalId = randomUUID()
    const proposal = em.create(InboxProposal, {
      id: proposalId,
      inboxEmailId: submission.legacyInboxEmailId ?? null,
      sourceSubmissionId: submission.id,
      sourceEntityType: submission.sourceEntityType,
      sourceEntityId: submission.sourceEntityId,
      sourceArtifactId: submission.sourceArtifactId ?? null,
      sourceVersion,
      sourceSnapshot: submission.sourceSnapshot ?? null,
      summary: extractionResult.summary,
      category: extractionResult.category || null,
      participants: enrichedParticipants,
      confidence: String(extractionResult.confidence.toFixed(2)),
      detectedLanguage: extractionResult.detectedLanguage || legacyEmail?.detectedLanguage || null,
      status: 'pending',
      possiblyIncomplete,
      llmModel: modelUsed,
      llmTokensUsed: tokensUsed,
      workingLanguage,
      organizationId: submission.organizationId,
      tenantId: submission.tenantId,
    })
    em.persist(proposal)

    const autoContactActions = buildContactActionsForUnmatchedParticipants(
      contactMatches,
      extractionResult.proposedActions,
      sourceMetadata.forwardedByAddress,
    )
    const llmContactActions = buildContactActionsForUnmatchedLlmParticipants(
      enrichedParticipants,
      contactMatches,
      extractionResult.proposedActions,
      autoContactActions,
    )
    autoContactActions.push(...llmContactActions)

    const autoLinkActions = buildLinkContactActionsForMatchedParticipants(
      contactMatches,
      extractionResult.proposedActions,
      sourceMetadata.forwardedByAddress,
    )

    const dedupedProposedActions = deduplicateCompanyActions([
      ...autoContactActions,
      ...autoLinkActions,
      ...autoProductActions,
      ...extractionResult.proposedActions,
    ])

    const combinedProposedActions = dedupedProposedActions
    const allActions = [
      ...combinedProposedActions.map((action, index) => {
        const parsedPayload = safeParsePayloadJson(action.payloadJson)
        return em.create(InboxProposalAction, {
          id: randomUUID(),
          proposalId,
          sortOrder: index,
          actionType: action.actionType,
          description: action.description,
          payload: parsedPayload,
          status: 'pending',
          confidence: String(action.confidence.toFixed(2)),
          requiredFeature: action.requiredFeature || REQUIRED_FEATURES_MAP[action.actionType] || null,
          organizationId: submission.organizationId,
          tenantId: submission.tenantId,
        })
      }),
      ...extractionResult.draftReplies.map((reply, index) =>
        em.create(InboxProposalAction, {
          id: randomUUID(),
          proposalId,
          sortOrder: combinedProposedActions.length + index,
          actionType: 'draft_reply',
          description: 'inbox_ops.action.desc.draft_reply',
          payload: {
            to: reply.to,
            toName: reply.toName,
            subject: reply.subject,
            body: reply.body,
            context: reply.context,
            replyTo: sourceMetadata.replyTo ?? null,
            inReplyToMessageId: sourceMetadata.messageId ?? null,
            references: sourceMetadata.references ?? null,
          },
          status: 'pending',
          confidence: String(extractionResult.confidence.toFixed(2)),
          requiredFeature: 'inbox_ops.replies.send',
          organizationId: submission.organizationId,
          tenantId: submission.tenantId,
        }),
      ),
    ]
    allActions.forEach((action) => em.persist(action))

    const actionIndexOffset = autoContactActions.length + autoLinkActions.length + autoProductActions.length
    const offsetIndex = (discrepancy: DiscrepancyInput): DiscrepancyInput =>
      discrepancy.actionIndex !== undefined
        ? { ...discrepancy, actionIndex: discrepancy.actionIndex + actionIndexOffset }
        : discrepancy

    const allDiscrepancies = [
      ...extractionResult.discrepancies.map((discrepancy) =>
        createDiscrepancy(em, proposalId, allActions, offsetIndex(discrepancy), scope),
      ),
      ...priceDiscrepancies.map((discrepancy) =>
        createDiscrepancy(em, proposalId, allActions, offsetIndex(discrepancy), scope),
      ),
      ...duplicateOrderDiscrepancies.map((discrepancy) =>
        createDiscrepancy(em, proposalId, allActions, offsetIndex(discrepancy), scope),
      ),
      ...productNotFoundDiscrepancies.map((discrepancy) =>
        createDiscrepancy(em, proposalId, allActions, offsetIndex(discrepancy), scope),
      ),
      ...enrichmentDiscrepancies.map((discrepancy) =>
        createDiscrepancy(em, proposalId, allActions, offsetIndex(discrepancy), scope),
      ),
    ]

    const contactDiscrepancyEmails = new Set<string>()
    for (const match of contactMatches) {
      if (!match.match && match.participant.email) {
        const emailLower = match.participant.email.toLowerCase()
        contactDiscrepancyEmails.add(emailLower)
        allDiscrepancies.push(
          createDiscrepancy(em, proposalId, allActions, {
            type: 'unknown_contact',
            severity: 'warning',
            description: 'inbox_ops.discrepancy.desc.no_matching_contact',
            foundValue: `${match.participant.name} (${match.participant.email})`,
          }, scope),
        )
      }
    }

    for (const participant of enrichedParticipants) {
      if (participant.matchedContactId) continue
      const emailLower = (participant.email || '').toLowerCase()
      if (!emailLower || contactDiscrepancyEmails.has(emailLower)) continue
      contactDiscrepancyEmails.add(emailLower)
      allDiscrepancies.push(
        createDiscrepancy(em, proposalId, allActions, {
          type: 'unknown_contact',
          severity: 'warning',
          description: 'inbox_ops.discrepancy.desc.no_matching_contact',
          foundValue: `${participant.name} (${participant.email})`,
        }, scope),
      )
    }

    const matchedEmails = new Set(
      contactMatches
        .filter((match) => match.match?.contactId)
        .map((match) => match.participant.email.toLowerCase()),
    )
    for (const [actionIndex, action] of allActions.entries()) {
      if (action.actionType !== 'draft_reply') continue
      const payloadRecord = action.payload as Record<string, unknown> | null
      const toEmail = typeof payloadRecord?.to === 'string' ? payloadRecord.to.trim().toLowerCase() : ''
      if (toEmail && !matchedEmails.has(toEmail)) {
        allDiscrepancies.push(
          createDiscrepancy(em, proposalId, allActions, {
            actionIndex,
            type: 'unknown_contact',
            severity: 'error',
            description: 'inbox_ops.discrepancy.desc.draft_reply_no_contact',
            foundValue: toEmail,
          }, scope),
        )
      }
    }

    allDiscrepancies.forEach((discrepancy) => em.persist(discrepancy))

    submission.status = 'processed'
    submission.processingError = null
    submission.proposalId = proposal.id

    if (legacyEmail) {
      legacyEmail.status = requiresReview ? 'needs_review' : 'processed'
      legacyEmail.detectedLanguage = extractionResult.detectedLanguage || legacyEmail.detectedLanguage
      legacyEmail.processingError = null
    }

    await em.flush()

    try {
      const cache = resolveCache(ctx)
      await runWithCacheTenant(submission.tenantId, () => invalidateCountsCache(cache, submission.tenantId))
    } catch (cacheError) {
      console.warn('[inbox_ops:source-worker] Cache invalidation failed (non-fatal):', cacheError)
    }

    if (legacyEmail) {
      try {
        await createMessageRecordForEmail(
          {
            id: legacyEmail.id,
            subject: legacyEmail.subject,
            cleanedText: legacyEmail.cleanedText,
            rawText: legacyEmail.rawText,
            forwardedByAddress: legacyEmail.forwardedByAddress,
            forwardedByName: legacyEmail.forwardedByName,
            status: legacyEmail.status,
          },
          {
            container: ctx,
            scope: {
              tenantId: legacyEmail.tenantId,
              organizationId: legacyEmail.organizationId,
              userId: SYSTEM_USER_ID,
            },
          },
        )
      } catch (messageError) {
        console.error('[inbox_ops:source-worker] Messages integration failed (non-fatal):', messageError)
      }
    }

    try {
      await emitInboxOpsEvent('inbox_ops.source_submission.processed', {
        sourceSubmissionId: submission.id,
        proposalId: proposal.id,
        tenantId: submission.tenantId,
        organizationId: submission.organizationId,
        sourceEntityType: submission.sourceEntityType,
        sourceEntityId: submission.sourceEntityId,
      })

      await emitInboxOpsEvent('inbox_ops.proposal.created', {
        proposalId: proposal.id,
        emailId: legacyEmail?.id ?? null,
        sourceSubmissionId: submission.id,
        tenantId: submission.tenantId,
        organizationId: submission.organizationId,
        actionCount: allActions.length,
        discrepancyCount: allDiscrepancies.length,
        confidence: proposal.confidence,
        summary: proposal.summary,
      })

      if (legacyEmail) {
        await emitInboxOpsEvent('inbox_ops.email.processed', {
          emailId: legacyEmail.id,
          tenantId: legacyEmail.tenantId,
          organizationId: legacyEmail.organizationId,
        })
      }
    } catch (eventError) {
      console.error('[inbox_ops:source-worker] Failed to emit events:', eventError)
    }
  } catch (error) {
    submission.status = 'failed'
    submission.processingError = error instanceof Error ? error.message : String(error)

    if (submission.legacyInboxEmailId) {
      legacyEmail = legacyEmail ?? await findOneWithDecryption(
        em,
        InboxEmail,
        {
          id: submission.legacyInboxEmailId,
          organizationId: submission.organizationId,
          tenantId: submission.tenantId,
          deletedAt: null,
        },
        undefined,
        scope,
      )
      if (legacyEmail) {
        legacyEmail.status = 'failed'
        legacyEmail.processingError = submission.processingError
      }
    }

    await em.flush()

    try {
      await emitInboxOpsEvent('inbox_ops.source_submission.failed', {
        sourceSubmissionId: submission.id,
        tenantId: submission.tenantId,
        organizationId: submission.organizationId,
        sourceEntityType: submission.sourceEntityType,
        sourceEntityId: submission.sourceEntityId,
        error: submission.processingError,
      })

      if (legacyEmail) {
        await emitInboxOpsEvent('inbox_ops.email.failed', {
          emailId: legacyEmail.id,
          tenantId: legacyEmail.tenantId,
          organizationId: legacyEmail.organizationId,
          error: legacyEmail.processingError,
        })
      }
    } catch (eventError) {
      console.error('[inbox_ops:source-worker] Failed to emit failure events:', eventError)
    }

    console.error('[inbox_ops:source-worker] Extraction failed:', error)
  }
}

function normalizeOrderPayloadFields(payload: Record<string, unknown>): void {
  const lineItems = Array.isArray(payload.lineItems)
    ? (payload.lineItems as Record<string, unknown>[])
    : []
  for (const item of lineItems) {
    if (!item.productName && typeof item.description === 'string') {
      item.productName = item.description
    }
    if (typeof item.quantity === 'number') {
      item.quantity = String(item.quantity)
    }
    if (typeof item.unitPrice === 'number') {
      item.unitPrice = String(item.unitPrice)
    }
  }
}

function buildContactActionsForUnmatchedParticipants(
  contactMatches: { participant: { name: string; email: string }; match?: { contactId: string } | null }[],
  existingActions: { actionType: string; payloadJson: string }[],
  forwardedByAddress?: string,
): { actionType: 'create_contact'; description: string; confidence: number; requiredFeature: string; payloadJson: string }[] {
  const alreadyProposed = new Set(
    existingActions
      .filter((action) => action.actionType === 'create_contact')
      .map((action) => {
        const payload = safeParsePayloadJson(action.payloadJson)
        return typeof payload.email === 'string' ? payload.email.toLowerCase() : ''
      })
      .filter(Boolean),
  )

  const forwardedByLower = (forwardedByAddress || '').toLowerCase()
  const systemPatterns = ['noreply', 'no-reply', 'donotreply', 'mailer-daemon', 'postmaster']

  return contactMatches
    .filter((match) => {
      if (match.match?.contactId) return false
      const emailLower = match.participant.email.toLowerCase()
      if (!emailLower || !emailLower.includes('@')) return false
      if (alreadyProposed.has(emailLower)) return false
      if (forwardedByLower && emailLower === forwardedByLower) return false
      return !systemPatterns.some((pattern) => emailLower.includes(pattern))
    })
    .map((match) => ({
      actionType: 'create_contact' as const,
      description: 'inbox_ops.action.desc.create_contact',
      confidence: 0.9,
      requiredFeature: REQUIRED_FEATURES_MAP.create_contact,
      payloadJson: JSON.stringify({
        type: 'person',
        name: match.participant.name,
        email: match.participant.email,
        source: 'inbox_ops',
      }),
    }))
}

function buildLinkContactActionsForMatchedParticipants(
  contactMatches: { participant: { name: string; email: string }; match?: { contactId: string; contactType?: string; contactName?: string } | null }[],
  existingActions: { actionType: string; payloadJson: string }[],
  forwardedByAddress?: string,
): { actionType: 'link_contact'; description: string; confidence: number; requiredFeature: string; payloadJson: string }[] {
  const alreadyProposed = new Set(
    existingActions
      .filter((action) => action.actionType === 'link_contact')
      .map((action) => {
        const payload = safeParsePayloadJson(action.payloadJson)
        const email = typeof payload.emailAddress === 'string' ? payload.emailAddress : (typeof payload.email === 'string' ? payload.email : '')
        return email.toLowerCase()
      })
      .filter(Boolean),
  )

  const forwardedByLower = (forwardedByAddress || '').toLowerCase()
  const systemPatterns = ['noreply', 'no-reply', 'donotreply', 'mailer-daemon', 'postmaster']

  return contactMatches
    .filter((match) => {
      if (!match.match?.contactId) return false
      const emailLower = match.participant.email.toLowerCase()
      if (alreadyProposed.has(emailLower)) return false
      if (forwardedByLower && emailLower === forwardedByLower) return false
      return !systemPatterns.some((pattern) => emailLower.includes(pattern))
    })
    .map((match) => ({
      actionType: 'link_contact' as const,
      description: 'inbox_ops.action.desc.link_contact',
      confidence: 0.95,
      requiredFeature: REQUIRED_FEATURES_MAP.link_contact,
      payloadJson: JSON.stringify({
        emailAddress: match.participant.email,
        contactId: match.match!.contactId,
        contactType: match.match!.contactType || 'person',
        contactName: match.participant.name,
      }),
    }))
}

function buildContactActionsForUnmatchedLlmParticipants(
  enrichedParticipants: { name: string; email?: string | null; matchedContactId?: string | null }[],
  contactMatches: { participant: { email: string } }[],
  existingActions: { actionType: string; payloadJson: string }[],
  alreadyAutoCreated: { payloadJson: string }[],
): { actionType: 'create_contact'; description: string; confidence: number; requiredFeature: string; payloadJson: string }[] {
  const headerEmails = new Set(contactMatches.map((match) => match.participant.email.toLowerCase()))
  const alreadyProposed = new Set([
    ...existingActions
      .filter((action) => action.actionType === 'create_contact')
      .map((action) => {
        const payload = safeParsePayloadJson(action.payloadJson)
        return typeof payload.email === 'string' ? payload.email.toLowerCase() : ''
      })
      .filter(Boolean),
    ...alreadyAutoCreated
      .map((action) => {
        const payload = safeParsePayloadJson(action.payloadJson)
        return typeof payload.email === 'string' ? payload.email.toLowerCase() : ''
      })
      .filter(Boolean),
  ])

  const systemPatterns = ['noreply', 'no-reply', 'donotreply', 'mailer-daemon', 'postmaster']

  return enrichedParticipants
    .filter((participant) => {
      if (participant.matchedContactId) return false
      const emailLower = (participant.email || '').toLowerCase()
      if (!emailLower) return false
      if (headerEmails.has(emailLower)) return false
      if (alreadyProposed.has(emailLower)) return false
      return !systemPatterns.some((pattern) => emailLower.includes(pattern))
    })
    .map((participant) => ({
      actionType: 'create_contact' as const,
      description: 'inbox_ops.action.desc.create_contact',
      confidence: 0.85,
      requiredFeature: REQUIRED_FEATURES_MAP.create_contact,
      payloadJson: JSON.stringify({
        type: 'person',
        name: participant.name,
        email: participant.email,
        source: 'inbox_ops',
      }),
    }))
}

async function detectDuplicateOrders(
  em: EntityManager,
  orderActions: { actionType: string; payload: Record<string, unknown>; index: number }[],
  scope: { tenantId: string; organizationId: string },
  salesOrderClass?: EntityClass<{ id: string; orderNumber: string; customerReference?: string | null; tenantId?: string; organizationId?: string; deletedAt?: Date | null }>,
): Promise<{ type: 'duplicate_order'; severity: 'error'; description: string; expectedValue: string | null; foundValue: string | null; actionIndex: number }[]> {
  if (!salesOrderClass) return []
  const discrepancies: { type: 'duplicate_order'; severity: 'error'; description: string; expectedValue: string | null; foundValue: string | null; actionIndex: number }[] = []

  for (const action of orderActions) {
    if (action.actionType !== 'create_order') continue

    const customerReference = typeof action.payload.customerReference === 'string'
      ? action.payload.customerReference.trim()
      : null

    if (!customerReference) continue

    try {
      const existing = await findOneWithDecryption(
        em,
        salesOrderClass,
        {
          customerReference,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
        },
        undefined,
        scope,
      )

      if (existing) {
        discrepancies.push({
          type: 'duplicate_order',
          severity: 'error',
          description: 'inbox_ops.discrepancy.desc.duplicate_order_reference',
          expectedValue: existing.orderNumber || existing.id,
          foundValue: customerReference,
          actionIndex: action.index,
        })
      }
    } catch {
      continue
    }
  }

  return discrepancies
}

function buildParticipantEmailMap(
  contactMatches: { participant: { name: string; email: string } }[],
  llmParticipants: { name: string; email?: string | null }[],
): Map<string, string> {
  const nameToEmail = new Map<string, string>()
  for (const match of contactMatches) {
    if (match.participant.name && match.participant.email) {
      nameToEmail.set(match.participant.name.trim().toLowerCase(), match.participant.email.trim().toLowerCase())
    }
  }
  for (const participant of llmParticipants) {
    if (participant.name && participant.email) {
      const key = participant.name.trim().toLowerCase()
      if (!nameToEmail.has(key)) {
        nameToEmail.set(key, participant.email.trim().toLowerCase())
      }
    }
  }
  return nameToEmail
}

function enrichCreateContactEmails(
  actions: { actionType: string; payloadJson: string }[],
  participantEmailMap: Map<string, string>,
): void {
  for (const action of actions) {
    if (action.actionType !== 'create_contact') continue
    const payload = safeParsePayloadJson(action.payloadJson)
    if (payload.email) continue
    const name = typeof payload.name === 'string' ? payload.name.trim() : ''
    if (!name) continue
    const email = participantEmailMap.get(name.toLowerCase())
      ?? findPartialNameMatch(name, participantEmailMap)
    if (email) {
      payload.email = email
      action.payloadJson = JSON.stringify(payload)
    }
  }
}

function enrichDraftReplyTargets(
  draftReplies: { to: string; toName?: string; subject: string; body: string; context?: string }[],
  participantEmailMap: Map<string, string>,
): void {
  const knownEmails = new Set(participantEmailMap.values())
  for (const reply of draftReplies) {
    const toEmail = reply.to.trim().toLowerCase()
    if (knownEmails.has(toEmail)) continue
    const toName = (reply.toName || '').trim()
    if (!toName) continue
    const correctedEmail = participantEmailMap.get(toName.toLowerCase())
      ?? findPartialNameMatch(toName, participantEmailMap)
    if (correctedEmail) {
      reply.to = correctedEmail
    }
  }
}

function deduplicateCompanyActions<T extends { actionType: string; payloadJson: string }>(
  actions: T[],
): T[] {
  const personCompanyNames = new Set<string>()
  for (const action of actions) {
    if (action.actionType !== 'create_contact') continue
    const payload = safeParsePayloadJson(action.payloadJson)
    if (payload.type === 'person' && typeof payload.companyName === 'string' && payload.companyName.trim()) {
      personCompanyNames.add(payload.companyName.trim().toLowerCase())
    }
  }
  if (personCompanyNames.size === 0) return actions

  return actions.filter((action) => {
    if (action.actionType !== 'create_contact') return true
    const payload = safeParsePayloadJson(action.payloadJson)
    if (payload.type !== 'company') return true
    const companyName = typeof payload.name === 'string' ? payload.name.trim().toLowerCase() : ''
    return !companyName || !personCompanyNames.has(companyName)
  })
}

function findPartialNameMatch(name: string, map: Map<string, string>): string | undefined {
  const lower = name.toLowerCase()
  const parts = lower.split(/\s*[\/,]\s*/).map((part) => part.trim()).filter(Boolean)
  for (const part of parts) {
    const match = map.get(part)
    if (match) return match
  }
  for (const [mapName, mapEmail] of map) {
    if (lower.includes(mapName) || mapName.includes(lower)) {
      return mapEmail
    }
    for (const part of parts) {
      if (part.includes(mapName) || mapName.includes(part)) {
        return mapEmail
      }
    }
  }
  return undefined
}
