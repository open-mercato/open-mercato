/**
 * Voice Channels — Shared Types
 *
 * Shared across hub module, provider packages, and Copilot UI.
 * SPEC-070 + SPEC-072
 */

// ─── Call Status ──────────────────────────────────────────────

export type UnifiedCallStatus =
  | 'ringing'
  | 'active'
  | 'on_hold'
  | 'completed'
  | 'missed'
  | 'failed'
  | 'voicemail'
  | 'cancelled'

// ─── Transcript Segment ──────────────────────────────────────

export interface TranscriptSegment {
  segmentId: number
  speaker: 'rep' | 'customer' | 'unknown'
  text: string
  confidence: number
  isFinal: boolean
  startTime: number
  endTime: number
  language?: string
}

// ─── Intent Detection ────────────────────────────────────────

export type CopilotIntent =
  | 'product_need'
  | 'price_objection'
  | 'competitor_mention'
  | 'order_intent'
  | 'feature_question'
  | 'complaint'
  | 'small_talk'

export interface IntentDetectionResult {
  intent: CopilotIntent
  confidence: number
  keywords: string[]
  segmentId: number
}

// ─── Suggestion Cards ────────────────────────────────────────

export type SuggestionCardType =
  | 'product_suggestion'
  | 'pricing_alert'
  | 'customer_context'
  | 'deal_status'
  | 'quick_action'

export interface SuggestionCardBase {
  id: string
  type: SuggestionCardType
  priority: 'high' | 'medium' | 'low'
  triggerText: string
  triggerSegmentId: number
  matchConfidence: number
  detectedIntent?: string
  createdAt: number
}

export interface ProductSuggestionCard extends SuggestionCardBase {
  type: 'product_suggestion'
  products: Array<{
    id: string
    name: string
    sku: string
    price: { amount: number; currency: string; priceType: string }
    available: boolean
    stockQuantity?: number
    matchReason: string
  }>
}

export interface PricingAlertCard extends SuggestionCardBase {
  type: 'pricing_alert'
  currentPrice: number
  floorPrice: number
  maxDiscountPercent: number
  currency: string
  activePromotions: Array<{
    name: string
    discount: string
    validUntil: string
  }>
}

export interface CustomerContextCard extends SuggestionCardBase {
  type: 'customer_context'
  customer: {
    id: string
    name: string
    company: string
    lifetimeValue: number
    currency: string
    lastOrderDate: string
    orderCount: number
    avgOrderValue: number
    topCategories: string[]
    openTickets: number
    assignedRep: string
    notes: string
  }
}

export interface DealStatusCard extends SuggestionCardBase {
  type: 'deal_status'
  deals: Array<{
    id: string
    title: string
    stage: string
    value: number
    currency: string
    daysInStage: number
    isStalled: boolean
  }>
}

export interface QuickActionCard extends SuggestionCardBase {
  type: 'quick_action'
  actions: Array<{
    label: string
    actionType: 'create_quote' | 'schedule_followup' | 'add_note'
    prefill?: Record<string, unknown>
  }>
}

export type SuggestionCard =
  | ProductSuggestionCard
  | PricingAlertCard
  | CustomerContextCard
  | DealStatusCard
  | QuickActionCard

// ─── SSE Event Payloads ──────────────────────────────────────

export interface TranscriptSegmentEventPayload {
  callId: string
  segment: TranscriptSegment
}

export interface CopilotSuggestionEventPayload {
  callId: string
  suggestion: SuggestionCard
}

export interface CallStartEventPayload {
  callId: string
  phoneNumber: string
  direction: 'inbound' | 'outbound'
  customerId?: string
  customerName?: string
  companyName?: string
  startedAt: number
}

export interface CallEndEventPayload {
  callId: string
  durationSeconds: number
  segmentCount: number
  suggestionCount: number
}

// ─── Mock Call Script Format ─────────────────────────────────

export interface MockCallScript {
  callId: string
  phoneNumber: string
  direction: 'inbound' | 'outbound'
  customerId: string
  customerName: string
  companyName: string
  language: string
  segments: MockScriptSegment[]
}

export interface MockScriptSegment {
  segmentId: number
  speaker: 'rep' | 'customer'
  text: string
  delayMs: number
  expectedIntent?: CopilotIntent
}

// ─── MCP Tool Response Shapes ────────────────────────────────

export interface CopilotProductSearchResult {
  products: Array<{
    id: string
    name: string
    sku: string
    price: { amount: number; currency: string; priceType: string }
    available: boolean
    stockQuantity: number
    category: string
  }>
}

export interface CopilotCustomerContextResult {
  customer: {
    id: string
    name: string
    company: string
    lifetimeValue: number
    currency: string
    lastOrderDate: string
    orderCount: number
    avgOrderValue: number
    topCategories: string[]
    openTickets: number
    assignedRep: string
    notes: string
  }
}

export interface CopilotPricingCheckResult {
  productId: string
  productName: string
  basePrice: number
  customerPrice: number
  currency: string
  floorPrice: number
  maxDiscountPercent: number
  activePromotions: Array<{
    name: string
    discount: string
    validUntil: string
  }>
}

export interface CopilotOpenDealsResult {
  deals: Array<{
    id: string
    title: string
    stage: string
    value: number
    currency: string
    daysInStage: number
    isStalled: boolean
    probability: number
  }>
}
