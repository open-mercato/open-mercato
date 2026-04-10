import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type {
  TranscriptSegment,
  SuggestionCard,
  CopilotSuggestionEventPayload,
  IntentDetectionResult,
  CopilotIntent,
  CopilotProductSearchResult,
  CopilotCustomerContextResult,
  CopilotPricingCheckResult,
  CopilotOpenDealsResult,
} from '@open-mercato/voice-channels/modules/voice_channels/types'
import { IntentDetector } from './intent-detector'

/**
 * Copilot Orchestrator
 *
 * Pipeline: TranscriptSegment → IntentDetection → MCP Tool Call → SuggestionCard → Event Emission
 *
 * This class receives transcript segments (from the mock simulator or a real provider),
 * detects intents, calls MCP tools to fetch relevant data, and emits suggestion cards
 * through the event bus for the frontend to display.
 */
/**
 * Per-call session state. Stored in a Map keyed by callId
 * so multiple calls can be active simultaneously without race conditions.
 */
interface CopilotSession {
  callId: string
  customerId: string | null
  tenantId: string
  organizationId: string
  contextWindow: TranscriptSegment[]
  recentSuggestionTypes: Map<string, number>
  suggestionCounter: number
}

export class CopilotOrchestrator {
  private container: AppContainer
  private intentDetector: IntentDetector
  private sessions: Map<string, CopilotSession> = new Map()

  /** Maximum segments to keep in context window */
  private readonly MAX_CONTEXT_SEGMENTS = 30
  /** Minimum seconds between same suggestion type */
  private readonly DEDUP_INTERVAL_MS = 60_000

  constructor(container: AppContainer) {
    this.container = container
    this.intentDetector = new IntentDetector()
  }

  /**
   * Initialize for a new call. Emits CustomerContextCard immediately.
   */
  async startSession(
    callId: string,
    customerId: string | undefined,
    tenantId: string,
    organizationId: string
  ): Promise<void> {
    const session: CopilotSession = {
      callId,
      customerId: customerId ?? null,
      tenantId,
      organizationId,
      contextWindow: [],
      recentSuggestionTypes: new Map(),
      suggestionCounter: 0,
    }
    this.sessions.set(callId, session)

    // Auto-emit CustomerContextCard at call start
    if (customerId) {
      await this.emitCustomerContext(session, customerId)
    }
  }

  /**
   * Process an incoming transcript segment.
   * This is the main entry point called by the subscriber.
   * The callId is used to look up the correct session.
   */
  async processSegment(callId: string, segment: TranscriptSegment): Promise<void> {
    const session = this.sessions.get(callId)
    if (!session) return // No active session for this call

    // Add to context window
    session.contextWindow.push(segment)
    if (session.contextWindow.length > this.MAX_CONTEXT_SEGMENTS) {
      session.contextWindow.shift()
    }

    // Only detect intents on customer speech
    if (segment.speaker !== 'customer') return

    // Fast-track: keyword detection (immediate, < 10ms)
    const keywordResult = this.intentDetector.detectByKeywords(segment)

    if (keywordResult) {
      // Fire suggestion immediately from keyword match
      await this.routeIntentToSuggestion(session, keywordResult)
    }

    // Smart-track: LLM detection (async 2–4s, always runs in parallel)
    // LLM may produce a better result that upgrades or supplements the keyword match
    this.intentDetector
      .detectByLlm(segment, session.contextWindow)
      .then(async (llmResult) => {
        if (llmResult) {
          // If keyword already fired same intent, emit only if LLM confidence is significantly higher
          // If different intent, always emit (LLM found something keywords missed)
          if (!keywordResult) {
            await this.routeIntentToSuggestion(session, llmResult)
          } else if (llmResult.intent !== keywordResult.intent) {
            await this.routeIntentToSuggestion(session, llmResult)
          } else if (llmResult.confidence > keywordResult.confidence + 0.15) {
            // Same intent but much higher confidence — upgrade with richer LLM data
            await this.routeIntentToSuggestion(session, llmResult)
          }
          // Otherwise skip: keyword already handled this intent at similar confidence
        }
      })
      .catch((err) => console.error('[Orchestrator] LLM detection error:', err))
  }

  /**
   * Return all active sessions for the Copilot calls API.
   */
  getActiveSessions(): Array<{ callId: string; customerId: string | null; startedAt: number; segmentCount: number }> {
    return Array.from(this.sessions.values()).map(session => ({
      callId: session.callId,
      customerId: session.customerId,
      startedAt: Date.now(), // session start approximation
      segmentCount: session.contextWindow.length,
    }))
  }

  /**
   * End a call session. Clears state for that callId.
   */
  endSession(callId: string): void {
    this.sessions.delete(callId)
  }

  /**
   * Route a detected intent to the appropriate MCP tool and emit a suggestion card.
   */
  private async routeIntentToSuggestion(session: CopilotSession, result: IntentDetectionResult): Promise<void> {
    // Deduplication: skip if same type emitted recently
    const dedupKey = `${result.intent}`
    const lastEmitted = session.recentSuggestionTypes.get(dedupKey)
    if (lastEmitted && Date.now() - lastEmitted < this.DEDUP_INTERVAL_MS) return

    const triggerSegment = session.contextWindow.find(s => s.segmentId === result.segmentId)
    const triggerText = triggerSegment?.text ?? ''

    // Map intent to human-readable label for the intent toast
    const intentLabels: Record<string, string> = {
      product_need: 'Wykryto: zapotrzebowanie na produkt',
      price_objection: 'Wykryto: obiekcja cenowa',
      competitor_mention: 'Wykryto: wzmianka o konkurencji',
      order_intent: 'Wykryto: intencja zamówienia',
      feature_question: 'Wykryto: pytanie o szczegóły',
      complaint: 'Wykryto: reklamacja / problem',
    }

    let card: SuggestionCard | null = null

    try {
      switch (result.intent) {
        case 'product_need':
          card = await this.buildProductSuggestion(session, result.keywords, triggerText, result.segmentId, result.confidence)
          break
        case 'price_objection':
          card = await this.buildPricingAlert(session, triggerText, result.segmentId, result.confidence)
          break
        case 'order_intent':
          card = await this.buildQuickAction(session, triggerText, result.segmentId, result.confidence)
          break
        case 'competitor_mention':
          card = await this.buildPricingAlert(session, triggerText, result.segmentId, result.confidence)
          break
        case 'feature_question':
        case 'complaint':
          card = await this.buildDealStatus(session, triggerText, result.segmentId, result.confidence)
          break
        case 'small_talk':
          return // No suggestion for small talk
      }
    } catch (err) {
      console.error('[Orchestrator] Failed to build suggestion for intent:', result.intent, err)
      return
    }

    if (card) {
      // Attach detected intent label for the UI toast
      card.detectedIntent = intentLabels[result.intent] ?? result.intent
      session.recentSuggestionTypes.set(dedupKey, Date.now())
      await this.emitSuggestion(session, card)
    }
  }

  private async buildProductSuggestion(session: CopilotSession, keywords: string[], triggerText: string, triggerSegmentId: number, confidence: number): Promise<SuggestionCard | null> {
    const toolResult = await this.callMcpTool<CopilotProductSearchResult>('copilot_search_products', {
      keywords,
      customerId: session.customerId,
      limit: 3,
    }, session)

    if (!toolResult || toolResult.products.length === 0) return null

    return {
      id: this.nextSuggestionId(session),
      type: 'product_suggestion',
      priority: 'high',
      triggerText,
      triggerSegmentId,
      matchConfidence: Math.round(confidence * 100),
      createdAt: Date.now(),
      products: toolResult.products.map(p => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        price: p.price,
        available: p.available,
        stockQuantity: p.stockQuantity,
        matchReason: `Matched keywords: ${keywords.join(', ')}`,
      })),
    }
  }

  private async buildPricingAlert(session: CopilotSession, triggerText: string, triggerSegmentId: number, confidence: number): Promise<SuggestionCard | null> {
    const recentProductSegments = session.contextWindow
      .filter(s => s.speaker === 'customer')
      .slice(-5)

    const toolResult = await this.callMcpTool<CopilotPricingCheckResult>('copilot_check_pricing', {
      customerId: session.customerId,
      context: recentProductSegments.map(s => s.text).join(' '),
    }, session)

    if (!toolResult) return null

    return {
      id: this.nextSuggestionId(session),
      type: 'pricing_alert',
      priority: 'high',
      triggerText,
      triggerSegmentId,
      matchConfidence: Math.round(confidence * 100),
      createdAt: Date.now(),
      currentPrice: toolResult.customerPrice,
      floorPrice: toolResult.floorPrice,
      maxDiscountPercent: toolResult.maxDiscountPercent,
      currency: toolResult.currency,
      activePromotions: toolResult.activePromotions,
    }
  }

  private async buildQuickAction(session: CopilotSession, triggerText: string, triggerSegmentId: number, confidence: number): Promise<SuggestionCard> {
    return {
      id: this.nextSuggestionId(session),
      type: 'quick_action',
      priority: 'high',
      triggerText,
      triggerSegmentId,
      matchConfidence: Math.round(confidence * 100),
      createdAt: Date.now(),
      actions: [
        { label: 'Utwórz ofertę', actionType: 'create_quote', prefill: { customerId: session.customerId } },
        { label: 'Zaplanuj follow-up', actionType: 'schedule_followup', prefill: { customerId: session.customerId } },
        { label: 'Dodaj notatkę', actionType: 'add_note', prefill: {} },
      ],
    }
  }

  private async buildDealStatus(session: CopilotSession, triggerText: string, triggerSegmentId: number, confidence: number): Promise<SuggestionCard | null> {
    if (!session.customerId) return null

    const toolResult = await this.callMcpTool<CopilotOpenDealsResult>('copilot_open_deals', {
      customerId: session.customerId,
    }, session)

    if (!toolResult || toolResult.deals.length === 0) return null

    return {
      id: this.nextSuggestionId(session),
      type: 'deal_status',
      priority: 'medium',
      triggerText,
      triggerSegmentId,
      matchConfidence: Math.round(confidence * 100),
      createdAt: Date.now(),
      deals: toolResult.deals,
    }
  }

  private async emitCustomerContext(session: CopilotSession, customerId: string): Promise<void> {
    const toolResult = await this.callMcpTool<CopilotCustomerContextResult>('copilot_customer_context', {
      customerId,
    }, session)

    if (!toolResult) return

    const card: SuggestionCard = {
      id: this.nextSuggestionId(session),
      type: 'customer_context',
      priority: 'medium',
      triggerText: 'Połączenie rozpoczęte — załadowano kontekst klienta',
      triggerSegmentId: 0, // Auto-emitted at call start, no triggering segment
      matchConfidence: 100,
      detectedIntent: 'Automatyczny kontekst klienta',
      createdAt: Date.now(),
      customer: toolResult.customer,
    }

    await this.emitSuggestion(session, card)
  }

  /**
   * Call an MCP tool by name. Resolves the tool from the AI assistant registry.
   * For hackathon: falls back to direct DI resolution if MCP registry unavailable.
   */
  private async callMcpTool<T>(toolName: string, input: Record<string, unknown>, session: CopilotSession): Promise<T | null> {
    try {
      // Try resolving tool handler from DI container
      const handler = this.container.resolve<((input: any, ctx: any) => Promise<T>) | undefined>(
        `mcpTool:${toolName}`
      )
      if (handler) {
        return await handler(input, {
          tenantId: session.tenantId,
          organizationId: session.organizationId,
          userId: null,
          container: this.container,
          userFeatures: [],
          isSuperAdmin: true,
        })
      }

      // Fallback: try global tool registry
      const toolRegistry = this.container.resolve<any>('mcpToolRegistry')
      if (toolRegistry?.getTool) {
        const tool = toolRegistry.getTool(toolName)
        if (tool?.handler) {
          return await tool.handler(input, {
            tenantId: session.tenantId,
            organizationId: session.organizationId,
            userId: null,
            container: this.container,
            userFeatures: [],
            isSuperAdmin: true,
          })
        }
      }

      console.warn(`[Orchestrator] MCP tool "${toolName}" not found`)
      return null
    } catch (err) {
      console.error(`[Orchestrator] MCP tool "${toolName}" error:`, err)
      return null
    }
  }

  private async emitSuggestion(session: CopilotSession, card: SuggestionCard): Promise<void> {
    const { emitVoiceEvent } = require('../../events')
    await emitVoiceEvent('voice_channels.copilot.suggestion' as any, {
      callId: session.callId,
      suggestion: card,
      tenantId: session.tenantId,
      organizationId: session.organizationId,
    }, { persistent: false })
  }

  private nextSuggestionId(session: CopilotSession): string {
    return `sug_${session.callId}_${++session.suggestionCounter}`
  }
}
