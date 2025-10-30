import { embed } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'

export type EmbeddingServiceOptions = {
  apiKey?: string
  model?: string
}

export class EmbeddingService {
  private readonly apiKey: string | null
  private readonly model: string
  private client: ReturnType<typeof createOpenAI> | null = null

  constructor(private readonly opts: EmbeddingServiceOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY ?? null
    this.model = opts.model ?? 'text-embedding-3-small'
  }

  get available(): boolean {
    return Boolean(this.apiKey)
  }

  private ensureClient() {
    if (!this.apiKey) {
      throw new Error('[vector.embedding] Missing OPENAI_API_KEY environment variable')
    }
    if (!this.client) {
      this.client = createOpenAI({ apiKey: this.apiKey })
    }
    return this.client
  }

  async createEmbedding(input: string | string[]): Promise<number[]> {
    const merged = Array.isArray(input)
      ? input.map((part) => String(part ?? '')).filter((part) => part.length > 0).join('\n\n')
      : String(input ?? '')
    if (!merged.length) {
      throw new Error('[vector.embedding] Refusing to embed empty payload')
    }
    const client = this.ensureClient()
    try {
      const result = await embed({
        model: client.embedding(this.model),
        value: merged,
      })
      const emb = Array.isArray(result.embedding)
        ? result.embedding
        : Array.from(result.embedding as ArrayLike<number>)
      return emb.map((n) => Number.isFinite(n) ? Number(n) : 0)
    } catch (err: any) {
      const statusCandidate =
        err?.statusCode ?? err?.status ?? err?.response?.status ?? err?.response?.statusCode
      const status =
        typeof statusCandidate === 'number'
          ? Number.isFinite(statusCandidate) ? statusCandidate : undefined
          : typeof statusCandidate === 'string'
            ? Number.parseInt(statusCandidate, 10)
            : undefined
      const apiError = err?.data?.error ?? err?.body?.error ?? err?.response?.data?.error
      const apiMessage = apiError?.message ?? err?.response?.data?.message
      const apiCode = typeof apiError?.code === 'string' ? apiError.code : undefined
      const rawMessage = typeof apiMessage === 'string'
        ? apiMessage
        : (typeof err?.message === 'string' ? err.message : 'Embedding request failed')
      let guidance: string
      switch (apiCode) {
        case 'insufficient_quota':
          guidance = 'OpenAI usage quota exceeded. Please review your plan and billing.'
          break
        case 'invalid_api_key':
          guidance = 'Invalid OpenAI API key. Update the key and retry.'
          break
        case 'account_deactivated':
          guidance = 'OpenAI account is disabled. Contact OpenAI support or provide a different key.'
          break
        default:
          guidance = rawMessage.includes('https://')
            ? rawMessage
            : `${rawMessage}. Check OPENAI_API_KEY.`
      }
      const wrapped = new Error(`[vector.embedding] ${guidance}`)
      if (typeof status === 'number' && Number.isFinite(status)) {
        const normalizedStatus = status === 401 || status === 403 ? 502 : status
        if (normalizedStatus >= 400 && normalizedStatus < 600) {
          (wrapped as any).status = normalizedStatus
        }
      }
      if (apiCode) {
        (wrapped as any).code = apiCode
      }
      (wrapped as any).cause = err
      throw wrapped
    }
  }
}
