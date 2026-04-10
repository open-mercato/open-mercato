import type { TranscriptSegment, CopilotIntent, IntentDetectionResult } from '@open-mercato/voice-channels/modules/voice_channels/types'

/**
 * Keyword patterns for fast-track intent detection.
 * Supports Polish and English keywords.
 * Keys are intents, values are arrays of regex patterns (case-insensitive).
 */
const KEYWORD_PATTERNS: Record<CopilotIntent, RegExp[]> = {
  product_need: [
    /potrzebuj[eę]/i, /zamówi[ćę]/i, /szukam/i, /interesuj[eę]/i,
    /chciałbym/i, /chciałabym/i, /rur[yę]/i, /zaworów/i, /kształtek/i,
    /need/i, /looking for/i, /order/i, /want to buy/i, /interested in/i,
    /ile kosztuj[eą]/i, /cennik/i, /ofert[aęy]/i,
    /sztuk/i, /jednostek/i, /units/i, /pieces/i,
  ],
  price_objection: [
    /za drogo/i, /zbyt drogo/i, /cena.*wysok/i, /obniż/i, /rabat/i, /upust/i,
    /too expensive/i, /lower the price/i, /discount/i, /cheaper/i,
    /konkurencja.*taniej/i, /tańsz/i, /budżet/i, /nie stać/i,
  ],
  competitor_mention: [
    /konkurencj[aię]/i, /inna firma/i, /inny dostawca/i,
    /competitor/i, /other supplier/i, /alternative/i,
    /ofert[aęy] od/i, /porówna[ćł]/i,
  ],
  order_intent: [
    /zamawiam/i, /bierzemy/i, /biorę/i, /składam zamówienie/i,
    /wyślij.*zamówienie/i, /potwierdź/i, /akceptuj[ęe]/i,
    /let'?s go ahead/i, /place.*order/i, /confirm/i, /send.*quote/i,
    /umow[aęy]/i, /podpiszemy/i, /deal/i,
  ],
  feature_question: [
    /czy możecie/i, /czy oferujecie/i, /jak działaj?a/i, /jaki czas/i,
    /termin dostawy/i, /gwarancj/i, /certyfikat/i, /norma/i,
    /do you offer/i, /how does/i, /lead time/i, /warranty/i,
    /ile trwa/i, /możliwe/i,
  ],
  complaint: [
    /reklamacj[aię]/i, /opóźnien/i, /spóźnion/i, /uszkodzon/i,
    /problem/i, /niezadowolon/i, /zły.*jakości/i,
    /complaint/i, /late delivery/i, /damaged/i, /quality issue/i,
  ],
  small_talk: [
    /jak się masz/i, /co słychać/i, /pogoda/i, /weekend/i,
    /how are you/i, /weather/i, /holiday/i,
  ],
}

export class IntentDetector {
  /**
   * Fast-track: keyword-based intent detection.
   * Returns within microseconds. Use for demo reliability.
   */
  detectByKeywords(segment: TranscriptSegment): IntentDetectionResult | null {
    if (segment.speaker !== 'customer') return null

    const text = segment.text.toLowerCase()

    for (const [intent, patterns] of Object.entries(KEYWORD_PATTERNS) as Array<[CopilotIntent, RegExp[]]>) {
      const matchedKeywords: string[] = []
      for (const pattern of patterns) {
        const match = text.match(pattern)
        if (match) {
          matchedKeywords.push(match[0])
        }
      }
      if (matchedKeywords.length > 0) {
        return {
          intent,
          confidence: Math.min(0.6 + matchedKeywords.length * 0.1, 0.9),
          keywords: matchedKeywords,
          segmentId: segment.segmentId,
        }
      }
    }

    return null
  }

  /**
   * Smart-track: LLM-based intent detection.
   * Returns in 2–4 seconds. More accurate for nuanced speech.
   *
   * Uses structured output (JSON mode) with a fast model (Haiku-class).
   */
  async detectByLlm(
    segment: TranscriptSegment,
    contextSegments: TranscriptSegment[]
  ): Promise<IntentDetectionResult | null> {
    if (segment.speaker !== 'customer') return null

    // Build context from recent segments
    const conversationContext = contextSegments
      .slice(-10)
      .map(s => `[${s.speaker}] ${s.text}`)
      .join('\n')

    const systemPrompt = `You are an intent classifier for a B2B sales call copilot.
Analyze the LATEST customer message in the context of the conversation.
Classify into exactly ONE intent.

Intents:
- product_need: Customer expresses need for a product or asks about availability/specifications
- price_objection: Customer objects to pricing, asks for discount, mentions budget constraints
- competitor_mention: Customer mentions competitors, alternative suppliers, or comparison offers
- order_intent: Customer signals readiness to place an order, confirms a purchase, or asks for a quote
- feature_question: Customer asks about product features, delivery times, warranties, certifications
- complaint: Customer mentions past issues, quality problems, or delivery delays
- small_talk: Greetings, weather, personal topics — not business-related

Respond with JSON only: { "intent": "<intent>", "confidence": <0.0-1.0>, "keywords": ["<key phrases>"] }`

    const userPrompt = `Conversation context:
${conversationContext}

LATEST customer message to classify:
[customer] ${segment.text}`

    try {
      // Use the AI service from DI container if available
      // For hackathon: direct Anthropic API call as fallback
      const response = await this.callLlm(systemPrompt, userPrompt)
      if (!response) return null

      return {
        ...response,
        segmentId: segment.segmentId,
      }
    } catch (error) {
      console.error('[IntentDetector] LLM call failed:', error)
      return null
    }
  }

  private async callLlm(
    systemPrompt: string,
    userPrompt: string
  ): Promise<{ intent: CopilotIntent; confidence: number; keywords: string[] } | null> {
    // Implementation depends on available AI service in the container.
    // For hackathon, use direct fetch to Anthropic API:
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      console.warn('[IntentDetector] No ANTHROPIC_API_KEY — LLM intent detection disabled')
      return null
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (!response.ok) {
      console.error('[IntentDetector] API error:', response.status)
      return null
    }

    const data = await response.json()
    const text = data.content?.[0]?.text
    if (!text) return null

    try {
      const parsed = JSON.parse(text)
      if (parsed.intent && typeof parsed.confidence === 'number') {
        return {
          intent: parsed.intent as CopilotIntent,
          confidence: parsed.confidence,
          keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
        }
      }
    } catch {
      console.error('[IntentDetector] Failed to parse LLM response:', text)
    }
    return null
  }
}
