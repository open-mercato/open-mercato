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
    const result = await embed({
      model: client.embedding(this.model),
      value: merged,
    })
    const emb = Array.isArray(result.embedding)
      ? result.embedding
      : Array.from(result.embedding as ArrayLike<number>)
    return emb.map((n) => Number.isFinite(n) ? Number(n) : 0)
  }
}
