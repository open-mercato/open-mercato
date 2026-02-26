import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { EntityClass } from '@mikro-orm/core'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { InboxEmail, InboxProposal, InboxProposalAction, InboxDiscrepancy, InboxSettings } from '../data/entities'
import type { ExtractedParticipant, InboxDiscrepancyType } from '../data/entities'
import { extractionOutputSchema } from '../data/validators'
import { matchContacts } from '../lib/contactMatcher'
import { buildExtractionSystemPrompt, buildExtractionUserPrompt } from '../lib/extractionPrompt'
import { REQUIRED_FEATURES_MAP } from '../lib/constants'
import { fetchCatalogProductsForExtraction } from '../lib/catalogLookup'
import { enrichOrderPayload } from '../lib/payloadEnrichment'
import { validatePrices } from '../lib/priceValidator'
import { extractParticipantsFromThread } from '../lib/emailParser'
import { runExtractionWithConfiguredProvider } from '../lib/llmProvider'
import { safeParsePayloadJson } from '../lib/validation'
import { htmlToPlainText } from '../lib/htmlToPlainText'
import { emitInboxOpsEvent } from '../events'

export const metadata = {
  event: 'inbox_ops.email.received',
  persistent: true,
  id: 'inbox_ops:extraction-worker',
}

interface EmailReceivedPayload {
  emailId: string
  tenantId: string
  organizationId: string
  forwardedByAddress: string
  subject: string
}

interface ResolverContext {
  resolve: <T = unknown>(name: string) => T
}

interface ExtractionEntityClasses {
  customerEntity?: EntityClass<{ id: string; kind: string; displayName: string; primaryEmail?: string | null }>
  catalogProduct?: EntityClass<{ id: string; name: string; sku?: string | null; tenantId?: string; organizationId?: string; deletedAt?: Date | null }>
  catalogProductPrice?: EntityClass<{ product?: unknown; unitPriceNet?: string | null; unitPriceGross?: string | null; currencyCode?: string | null; tenantId?: string; organizationId?: string; deletedAt?: Date | null; createdAt?: Date }>
  salesOrder?: EntityClass<{ id: string; orderNumber: string; customerReference?: string | null; tenantId?: string; organizationId?: string; deletedAt?: Date | null }>
  salesChannel?: EntityClass<{ id: string; name: string; currencyCode?: string; tenantId?: string; organizationId?: string; deletedAt?: Date | null }>
  customerAddress?: EntityClass<{ id: string; isPrimary: boolean; tenantId?: string; organizationId?: string; entity?: { id: string } | string; createdAt?: Date }>
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
    console.debug(`[inbox_ops:extraction] optional dependency "${name}" not available`)
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

export default async function handle(payload: EmailReceivedPayload, ctx: ResolverContext) {
  const em = (ctx.resolve('em') as EntityManager).fork()
  const entityClasses = resolveEntityClasses(ctx)

  // Optimistic lock: atomically claim the email for processing.
  // If another worker already claimed it, nativeUpdate returns 0 rows.
  const claimed = await em.nativeUpdate(
    InboxEmail,
    { id: payload.emailId, status: 'received' },
    { status: 'processing' },
  )
  if (claimed === 0) return

  const email = await findOneWithDecryption(
    em,
    InboxEmail,
    { id: payload.emailId },
    undefined,
    { tenantId: payload.tenantId, organizationId: payload.organizationId },
  )
  if (!email) {
    console.error(`[inbox_ops:extraction-worker] Email not found: ${payload.emailId}`)
    return
  }

  try {
    const scope = {
      tenantId: email.tenantId,
      organizationId: email.organizationId,
    }

    // Load tenant settings for working language
    const settings = await findOneWithDecryption(em, InboxSettings, { organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null }, undefined, scope)
    const workingLanguage = settings?.workingLanguage || 'en'

    // Step 1: Build full text for LLM extraction.
    // Use rawText (or derive from rawHtml) instead of cleanedText because
    // cleanedText strips quoted replies — which contain the actual order content
    // in forwarded email threads.
    const fullText = buildFullTextForExtraction(email)
    if (!fullText.trim()) {
      email.status = 'failed'
      email.processingError = 'No text content found in email'
      await em.flush()
      return
    }

    // Step 2: Match contacts from thread participants
    const threadParticipants = extractParticipantsFromThread(email)
    const contactMatches = await matchContacts(em, threadParticipants, scope,
      entityClasses.customerEntity ? { customerEntityClass: entityClasses.customerEntity } : undefined,
    )

    // Step 2b: Fetch catalog products for LLM context
    const catalogProducts = await fetchCatalogProductsForExtraction(em, scope,
      entityClasses.catalogProduct && entityClasses.catalogProductPrice
        ? { catalogProductClass: entityClasses.catalogProduct, catalogProductPriceClass: entityClasses.catalogProductPrice }
        : undefined,
    )

    // Step 3: Call LLM for extraction
    const maxTextSize = parseInt(process.env.INBOX_OPS_MAX_TEXT_SIZE || '204800', 10)
    const truncatedText = fullText.slice(0, maxTextSize)

    const systemPrompt = await buildExtractionSystemPrompt(contactMatches, catalogProducts, undefined, workingLanguage)
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
        await emitInboxOpsEvent('inbox_ops.email.failed', {
          emailId: email.id,
          tenantId: email.tenantId,
          organizationId: email.organizationId,
          error: email.processingError,
        })
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
      .map((action, index) => ({
        ...action, payload: safeParsePayloadJson(action.payloadJson), index,
      }))
      .filter((a) => a.actionType === 'create_order' || a.actionType === 'create_quote')

    const priceDiscrepancies = await validatePrices(em, orderActions, scope,
      entityClasses.catalogProductPrice ? { catalogProductPriceClass: entityClasses.catalogProductPrice } : undefined,
    )

    // Step 4b: Check for duplicate orders by customerReference
    const duplicateOrderDiscrepancies = await detectDuplicateOrders(em, orderActions, scope, entityClasses.salesOrder)

    // Step 5: Match LLM-discovered participants not found in email headers.
    // Header-based matchContacts (step 2) only covers From/To/Cc addresses.
    // In forwarded threads, the original sender is in the body, not the headers.
    const headerEmails = new Set(contactMatches.map((m) => m.participant.email.toLowerCase()))
    const llmOnlyParticipants = extractionResult.participants
      .filter((p) => p.email && !headerEmails.has(p.email.toLowerCase()))
      .map((p) => ({ name: p.name, email: p.email, role: p.role || 'unknown' }))

    if (llmOnlyParticipants.length > 0) {
      const llmContactMatches = await matchContacts(em, llmOnlyParticipants, scope,
        entityClasses.customerEntity ? { customerEntityClass: entityClasses.customerEntity } : undefined,
      )
      contactMatches.push(...llmContactMatches)
    }

    // Step 5b: Merge contact match data into participants
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

    // Step 6b: Normalize + enrich order/quote payloads
    const enrichmentDiscrepancies: DiscrepancyInput[] = []
    for (const [actionIndex, action] of extractionResult.proposedActions.entries()) {
      if (action.actionType === 'create_order' || action.actionType === 'create_quote') {
        const parsedPayload = safeParsePayloadJson(action.payloadJson)

        normalizeOrderPayloadFields(parsedPayload)

        const { payload: enriched, warnings } = await enrichOrderPayload(parsedPayload, {
          em,
          scope,
          contactMatches,
          catalogProducts,
          senderEmail: email.forwardedByAddress,
          salesChannelClass: entityClasses.salesChannel,
          customerAddressClass: entityClasses.customerAddress,
        })

        action.payloadJson = JSON.stringify(enriched)

        // Discrepancy descriptions are stored in the DB and rendered on the proposal review page.
        // Not i18n keys — the proposal UI displays them as-is for operator guidance.
        for (const warning of warnings) {
          if (warning === 'no_channel_resolved') {
            enrichmentDiscrepancies.push({
              actionIndex,
              type: 'other',
              severity: 'error',
              description: 'No sales channel available. Create a channel in Sales settings before accepting this order.',
            })
          } else if (warning === 'no_currency_resolved') {
            enrichmentDiscrepancies.push({
              actionIndex,
              type: 'currency_mismatch',
              severity: 'warning',
              description: 'No currency could be resolved for this order. Set a currency code or configure a sales channel with a default currency.',
            })
          }
        }
      }
    }

    // Step 6b-2: Enrich create_contact payloads with participant emails when the LLM omitted them,
    // and fix hallucinated draft_reply target emails using known participant data.
    const participantEmailMap = buildParticipantEmailMap(contactMatches, extractionResult.participants)
    enrichCreateContactEmails(extractionResult.proposedActions, participantEmailMap)
    enrichDraftReplyTargets(extractionResult.draftReplies, participantEmailMap)

    // Step 6c: Detect unresolved products and auto-generate create_product actions
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
            description: `Product "${productName}" could not be matched to any catalog product`,
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
              description: `Create catalog product "${productName}"`,
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

    // Step 7: Create proposal + actions + discrepancies atomically
    const proposalId = randomUUID()
    const proposal = em.create(InboxProposal, {
      id: proposalId,
      inboxEmailId: email.id,
      summary: extractionResult.summary,
      participants: enrichedParticipants,
      confidence: String(extractionResult.confidence.toFixed(2)),
      detectedLanguage: extractionResult.detectedLanguage || email.detectedLanguage,
      status: 'pending',
      possiblyIncomplete,
      llmModel: modelUsed,
      llmTokensUsed: tokensUsed,
      workingLanguage,
      organizationId: email.organizationId,
      tenantId: email.tenantId,
    })
    em.persist(proposal)

    // Step 6d: Auto-generate create_contact actions for unmatched participants (from headers)
    const autoContactActions = buildContactActionsForUnmatchedParticipants(
      contactMatches,
      extractionResult.proposedActions,
      email.toAddress,
    )

    // Step 6d-2: Also generate create_contact for LLM-discovered unmatched participants
    const llmContactActions = buildContactActionsForUnmatchedLlmParticipants(
      enrichedParticipants,
      contactMatches,
      extractionResult.proposedActions,
      autoContactActions,
      email.toAddress,
    )
    autoContactActions.push(...llmContactActions)

    // Step 6e: Auto-generate link_contact actions for matched participants
    const autoLinkActions = buildLinkContactActionsForMatchedParticipants(
      contactMatches,
      extractionResult.proposedActions,
      email.toAddress,
    )

    // Create actions — contact & product creation actions go first so they're executed before orders
    const combinedProposedActions = [...autoContactActions, ...autoLinkActions, ...autoProductActions, ...extractionResult.proposedActions]
    const allActions = [
      ...combinedProposedActions.map((action, index) => {
        const parsedPayload = safeParsePayloadJson(action.payloadJson)
        return em.create(InboxProposalAction, {
          id: randomUUID(),
          proposalId: proposalId,
          sortOrder: index,
          actionType: action.actionType,
          description: action.description,
          payload: parsedPayload,
          status: 'pending',
          confidence: String(action.confidence.toFixed(2)),
          requiredFeature: action.requiredFeature || REQUIRED_FEATURES_MAP[action.actionType] || null,
          organizationId: email.organizationId,
          tenantId: email.tenantId,
        })
      }),
      ...extractionResult.draftReplies.map((reply, index) =>
        em.create(InboxProposalAction, {
          id: randomUUID(),
          proposalId: proposalId,
          sortOrder: combinedProposedActions.length + index,
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

    // Discrepancy actionIndex values reference extractionResult.proposedActions,
    // but allActions prepends auto-generated actions. Offset indices accordingly.
    const actionIndexOffset = autoContactActions.length + autoLinkActions.length + autoProductActions.length
    const offsetIndex = (d: DiscrepancyInput): DiscrepancyInput =>
      d.actionIndex !== undefined ? { ...d, actionIndex: d.actionIndex + actionIndexOffset } : d

    // Create discrepancies using factory
    const allDiscrepancies = [
      ...extractionResult.discrepancies.map((d) =>
        createDiscrepancy(em, proposalId, allActions, offsetIndex(d), scope),
      ),
      ...priceDiscrepancies.map((d) =>
        createDiscrepancy(em, proposalId, allActions, offsetIndex(d), scope),
      ),
      ...duplicateOrderDiscrepancies.map((d) =>
        createDiscrepancy(em, proposalId, allActions, offsetIndex(d), scope),
      ),
      ...productNotFoundDiscrepancies.map((d) =>
        createDiscrepancy(em, proposalId, allActions, offsetIndex(d), scope),
      ),
      ...enrichmentDiscrepancies.map((d) =>
        createDiscrepancy(em, proposalId, allActions, offsetIndex(d), scope),
      ),
    ]

    // Flag unmatched contacts as discrepancies (from header-based matches + LLM-discovered participants)
    const contactDiscrepancyEmails = new Set<string>()
    for (const match of contactMatches) {
      if (!match.match && match.participant.email) {
        const emailLower = match.participant.email.toLowerCase()
        contactDiscrepancyEmails.add(emailLower)
        allDiscrepancies.push(
          createDiscrepancy(em, proposalId, allActions, {
            type: 'unknown_contact',
            severity: 'warning',
            description: `No matching contact found for ${match.participant.name} (${match.participant.email})`,
            foundValue: match.participant.email,
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
          description: `No matching contact found for ${participant.name} (${participant.email})`,
          foundValue: participant.email,
        }, scope),
      )
    }

    // Flag draft_reply actions that target unmatched contacts (blocks accept)
    const matchedEmails = new Set(
      contactMatches
        .filter((m) => m.match?.contactId)
        .map((m) => m.participant.email.toLowerCase()),
    )
    for (const [actionIndex, action] of allActions.entries()) {
      if (action.actionType !== 'draft_reply') continue
      const payload = action.payload as Record<string, unknown> | null
      const toEmail = typeof payload?.to === 'string' ? payload.to.trim().toLowerCase() : ''
      if (toEmail && !matchedEmails.has(toEmail)) {
        allDiscrepancies.push(
          createDiscrepancy(em, proposalId, allActions, {
            actionIndex,
            type: 'unknown_contact',
            severity: 'error',
            description: `Draft reply target "${toEmail}" has no matching contact. Create the contact first.`,
            foundValue: toEmail,
          }, scope),
        )
      }
    }

    allDiscrepancies.forEach((d) => em.persist(d))

    // Step 8: Update email status
    email.status = requiresReview ? 'needs_review' : 'processed'
    email.detectedLanguage = extractionResult.detectedLanguage || email.detectedLanguage

    await em.flush()

    // Step 9: Emit events
    try {
      await emitInboxOpsEvent('inbox_ops.email.processed', {
        emailId: email.id,
        tenantId: email.tenantId,
        organizationId: email.organizationId,
      })

      await emitInboxOpsEvent('inbox_ops.proposal.created', {
        proposalId: proposal.id,
        emailId: email.id,
        tenantId: email.tenantId,
        organizationId: email.organizationId,
        actionCount: allActions.length,
        discrepancyCount: allDiscrepancies.length,
        confidence: proposal.confidence,
        summary: proposal.summary,
      })
    } catch (eventError) {
      console.error('[inbox_ops:extraction-worker] Failed to emit events:', eventError)
    }
  } catch (err) {
    email.status = 'failed'
    email.processingError = err instanceof Error ? err.message : String(err)
    await em.flush()

    try {
      await emitInboxOpsEvent('inbox_ops.email.failed', {
        emailId: email.id,
        tenantId: email.tenantId,
        organizationId: email.organizationId,
        error: email.processingError,
      })
    } catch (eventError) {
      console.error('[inbox_ops:extraction-worker] Failed to emit email.failed event:', eventError)
    }

    console.error('[inbox_ops:extraction-worker] Extraction failed:', err)
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
  inboxAddress: string,
): { actionType: 'create_contact'; description: string; confidence: number; requiredFeature: string; payloadJson: string }[] {
  const alreadyProposed = new Set(
    existingActions
      .filter((a) => a.actionType === 'create_contact')
      .map((a) => {
        const p = safeParsePayloadJson(a.payloadJson)
        return typeof p.email === 'string' ? p.email.toLowerCase() : ''
      })
      .filter(Boolean),
  )

  const inboxLower = (inboxAddress || '').toLowerCase()
  const systemPatterns = ['noreply', 'no-reply', 'donotreply', 'mailer-daemon', 'postmaster']

  return contactMatches
    .filter((m) => {
      if (m.match?.contactId) return false
      const emailLower = m.participant.email.toLowerCase()
      if (alreadyProposed.has(emailLower)) return false
      if (emailLower === inboxLower) return false
      return !systemPatterns.some((p) => emailLower.includes(p))
    })
    .map((m) => ({
      actionType: 'create_contact' as const,
      description: `Create contact for ${m.participant.name} (${m.participant.email})`,
      confidence: 0.9,
      requiredFeature: REQUIRED_FEATURES_MAP.create_contact,
      payloadJson: JSON.stringify({
        type: 'person',
        name: m.participant.name,
        email: m.participant.email,
        source: 'inbox_ops',
      }),
    }))
}

function buildLinkContactActionsForMatchedParticipants(
  contactMatches: { participant: { name: string; email: string }; match?: { contactId: string; contactType?: string; contactName?: string } | null }[],
  existingActions: { actionType: string; payloadJson: string }[],
  inboxAddress: string,
): { actionType: 'link_contact'; description: string; confidence: number; requiredFeature: string; payloadJson: string }[] {
  const alreadyProposed = new Set(
    existingActions
      .filter((a) => a.actionType === 'link_contact')
      .map((a) => {
        const p = safeParsePayloadJson(a.payloadJson)
        const email = typeof p.emailAddress === 'string' ? p.emailAddress : (typeof p.email === 'string' ? p.email : '')
        return email.toLowerCase()
      })
      .filter(Boolean),
  )

  const inboxLower = (inboxAddress || '').toLowerCase()
  const systemPatterns = ['noreply', 'no-reply', 'donotreply', 'mailer-daemon', 'postmaster']

  return contactMatches
    .filter((m) => {
      if (!m.match?.contactId) return false
      const emailLower = m.participant.email.toLowerCase()
      if (alreadyProposed.has(emailLower)) return false
      if (emailLower === inboxLower) return false
      return !systemPatterns.some((p) => emailLower.includes(p))
    })
    .map((m) => ({
      actionType: 'link_contact' as const,
      description: `Link ${m.participant.name} (${m.participant.email}) to existing contact`,
      confidence: 0.95,
      requiredFeature: REQUIRED_FEATURES_MAP.link_contact,
      payloadJson: JSON.stringify({
        emailAddress: m.participant.email,
        contactId: m.match!.contactId,
        contactType: m.match!.contactType || 'person',
        contactName: m.participant.name,
      }),
    }))
}

function buildContactActionsForUnmatchedLlmParticipants(
  enrichedParticipants: { name: string; email: string; matchedContactId?: string | null }[],
  contactMatches: { participant: { email: string } }[],
  existingActions: { actionType: string; payloadJson: string }[],
  alreadyAutoCreated: { payloadJson: string }[],
  inboxAddress: string,
): { actionType: 'create_contact'; description: string; confidence: number; requiredFeature: string; payloadJson: string }[] {
  const headerEmails = new Set(
    contactMatches.map((m) => m.participant.email.toLowerCase()),
  )

  const alreadyProposed = new Set([
    ...existingActions
      .filter((a) => a.actionType === 'create_contact')
      .map((a) => {
        const p = safeParsePayloadJson(a.payloadJson)
        return typeof p.email === 'string' ? p.email.toLowerCase() : ''
      })
      .filter(Boolean),
    ...alreadyAutoCreated
      .map((a) => {
        const p = safeParsePayloadJson(a.payloadJson)
        return typeof p.email === 'string' ? p.email.toLowerCase() : ''
      })
      .filter(Boolean),
  ])

  const inboxLower = (inboxAddress || '').toLowerCase()
  const systemPatterns = ['noreply', 'no-reply', 'donotreply', 'mailer-daemon', 'postmaster']

  return enrichedParticipants
    .filter((p) => {
      if (p.matchedContactId) return false
      const emailLower = (p.email || '').toLowerCase()
      if (!emailLower) return false
      if (headerEmails.has(emailLower)) return false
      if (alreadyProposed.has(emailLower)) return false
      if (emailLower === inboxLower) return false
      return !systemPatterns.some((pat) => emailLower.includes(pat))
    })
    .map((p) => ({
      actionType: 'create_contact' as const,
      description: `Create contact for ${p.name} (${p.email})`,
      confidence: 0.85,
      requiredFeature: REQUIRED_FEATURES_MAP.create_contact,
      payloadJson: JSON.stringify({
        type: 'person',
        name: p.name,
        email: p.email,
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
          description: `An order with customer reference "${customerReference}" already exists (${existing.orderNumber || existing.id})`,
          expectedValue: null,
          foundValue: customerReference,
          actionIndex: action.index,
        })
      }
    } catch {
      // Skip duplicate detection if lookup fails
    }
  }

  return discrepancies
}

function detectPartialForward(email: InboxEmail): boolean {
  const subject = email.subject || ''
  const hasReOrFw = /^(RE|FW|Fwd):/i.test(subject)
  const messageCount = email.threadMessages?.length || 0
  return hasReOrFw && messageCount < 2
}

function buildParticipantEmailMap(
  contactMatches: { participant: { name: string; email: string } }[],
  llmParticipants: { name: string; email: string }[],
): Map<string, string> {
  const nameToEmail = new Map<string, string>()
  // Header-based participants are the most reliable source
  for (const m of contactMatches) {
    if (m.participant.name && m.participant.email) {
      nameToEmail.set(m.participant.name.trim().toLowerCase(), m.participant.email.trim().toLowerCase())
    }
  }
  // LLM-extracted participants as fallback (don't overwrite header-based)
  for (const p of llmParticipants) {
    if (p.name && p.email) {
      const key = p.name.trim().toLowerCase()
      if (!nameToEmail.has(key)) {
        nameToEmail.set(key, p.email.trim().toLowerCase())
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
    // Try exact name match first, then partial (first part before / or ,)
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
    // The LLM hallucinated an email — try to resolve via toName
    const toName = (reply.toName || '').trim()
    if (!toName) continue
    const correctedEmail = participantEmailMap.get(toName.toLowerCase())
      ?? findPartialNameMatch(toName, participantEmailMap)
    if (correctedEmail) {
      reply.to = correctedEmail
    }
  }
}

function buildFullTextForExtraction(email: InboxEmail): string {
  let text = email.rawText || ''
  if (!text && email.rawHtml) {
    text = htmlToPlainText(email.rawHtml)
  }
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function findPartialNameMatch(name: string, map: Map<string, string>): string | undefined {
  const lower = name.toLowerCase()
  // Split on common separators (e.g. "Marco Rossi / Rossi Imports S.r.l.")
  const parts = lower.split(/\s*[\/,]\s*/).map((p) => p.trim()).filter(Boolean)
  for (const part of parts) {
    const match = map.get(part)
    if (match) return match
  }
  // Try matching first+last name against map keys
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
