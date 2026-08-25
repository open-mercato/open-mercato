import { randomBytes, randomUUID } from 'crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesDocumentSequence, SalesSettings } from '../data/entities'
import {
  DEFAULT_ORDER_NUMBER_FORMAT,
  DEFAULT_QUOTE_NUMBER_FORMAT,
  DEFAULT_RETURN_NUMBER_FORMAT,
  DEFAULT_INVOICE_NUMBER_FORMAT,
  DEFAULT_CREDIT_MEMO_NUMBER_FORMAT,
  type SalesDocumentNumberKind,
} from '../lib/documentNumberTokens'

type Scope = {
  organizationId: string
  tenantId: string
}

type GenerateParams = Scope & {
  kind: SalesDocumentNumberKind
  format?: string | null
}

type SettingsSnapshot = {
  orderNumberFormat: string
  quoteNumberFormat: string
}

type SequenceSnapshot = {
  order: number
  quote: number
  return: number
}

const MAX_SEQUENCE = 1_000_000_000
const DEFAULT_SEQUENCE_START = 1

const createNanoId = (size = 12) => {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  const maxValid = 256 - (256 % alphabet.length) // 248 for alphabet.length=62
  let id = ''
  while (id.length < size) {
    const byte = randomBytes(1)[0]
    if (byte >= maxValid) continue // rejection sampling to avoid bias
    id += alphabet[byte % alphabet.length]
  }
  return id
}

const generateRandomDigits = (size = 4) => {
  const length = Math.max(1, Math.min(size, 12))
  const digits: string[] = []
  while (digits.length < length) {
    const byte = randomBytes(1)[0]
    if (byte >= 250) continue // rejection sampling: only use 0-249 which divides evenly by 10
    digits.push((byte % 10).toString())
  }
  return digits.join('')
}

type SequenceClaimWaiter = {
  resolve: (value: number) => void
  reject: (error: unknown) => void
}

export class SalesDocumentNumberGenerator {
  constructor(private readonly em: EntityManager) {}

  // Coalesces concurrent claims for the same (organization, tenant, kind) scope into a
  // single `sales_document_sequences` UPDATE (#5604): under sustained concurrent order
  // creation every caller previously issued its own single-row UPDATE, serializing on that
  // row's lock and bloating the table with one dead tuple per claim. Callers that arrive
  // while a claim for the same scope is already in flight join its queue instead of
  // starting a new round trip; the one caller that dispatches the DB call claims a block
  // covering every queued waiter with `current_value = current_value + waiterCount` and
  // hands out the resulting contiguous values in order. Under low concurrency (the common
  // case) each queue only ever holds one waiter, so this claims exactly one value per call —
  // identical to the previous behavior. State is per-instance: the DI-registered instance is
  // a singleton shared by every request (`sales/di.ts`), so this coalesces the hot
  // order/quote/invoice/credit-memo paths; the ad-hoc instance `sales.return.create`
  // constructs per call never has more than one in-flight claim, so it safely falls back to
  // today's one-claim-per-call behavior without risking a claim from one caller settling on
  // a connection that later rolls back another caller's transaction.
  private readonly sequenceQueues = new Map<string, SequenceClaimWaiter[]>()
  private readonly sequenceDispatching = new Set<string>()

  async getSettings(scope: Scope): Promise<SettingsSnapshot> {
    const record = await this.em.findOne(SalesSettings, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    return {
      orderNumberFormat: record?.orderNumberFormat?.trim() || DEFAULT_ORDER_NUMBER_FORMAT,
      quoteNumberFormat: record?.quoteNumberFormat?.trim() || DEFAULT_QUOTE_NUMBER_FORMAT,
    }
  }

  async peekSequences(scope: Scope): Promise<SequenceSnapshot> {
    const [order, quote, salesReturn] = await Promise.all([
      this.peekNextSequence('order', scope),
      this.peekNextSequence('quote', scope),
      this.peekNextSequence('return', scope),
    ])
    return { order, quote, return: salesReturn }
  }

  async setNextSequence(kind: SalesDocumentNumberKind, scope: Scope, nextValue: number): Promise<void> {
    const next = Math.min(Math.max(Math.floor(nextValue), DEFAULT_SEQUENCE_START), MAX_SEQUENCE)
    const baseValue = next - 1
    await this.em.getConnection().execute(
      `
        insert into sales_document_sequences (id, organization_id, tenant_id, document_kind, current_value, created_at, updated_at)
        values (gen_random_uuid(), ?, ?, ?, ?, now(), now())
        on conflict (organization_id, tenant_id, document_kind)
        do update set current_value = ?, updated_at = now()
      `,
      [scope.organizationId, scope.tenantId, kind, baseValue, baseValue]
    )
  }

  async generate(params: GenerateParams): Promise<{ number: string; format: string; sequence: number }> {
    const settings = await this.getSettings(params)
    const format =
      params.format?.trim() ||
      (params.kind === 'order'
        ? settings.orderNumberFormat
        : params.kind === 'quote'
          ? settings.quoteNumberFormat
          : params.kind === 'invoice'
            ? DEFAULT_INVOICE_NUMBER_FORMAT
            : params.kind === 'credit_memo'
              ? DEFAULT_CREDIT_MEMO_NUMBER_FORMAT
              : DEFAULT_RETURN_NUMBER_FORMAT)
    const sequence = await this.claimSequence(params.kind, params)
    const number = this.formatNumber(format, {
      kind: params.kind,
      sequence,
      date: new Date(),
      guid: randomUUID(),
    })
    return { number, format, sequence }
  }

  private async peekNextSequence(kind: SalesDocumentNumberKind, scope: Scope): Promise<number> {
    const record = await this.em.findOne(SalesDocumentSequence, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      documentKind: kind,
    })
    if (record && typeof record.currentValue === 'number') {
      return Math.min(record.currentValue + 1, MAX_SEQUENCE)
    }
    return DEFAULT_SEQUENCE_START
  }

  private claimSequence(kind: SalesDocumentNumberKind, scope: Scope): Promise<number> {
    const key = `${scope.organizationId}:${scope.tenantId}:${kind}`
    return new Promise<number>((resolve, reject) => {
      const queue = this.sequenceQueues.get(key) ?? []
      queue.push({ resolve, reject })
      this.sequenceQueues.set(key, queue)
      this.dispatchSequenceClaims(key, kind, scope)
    })
  }

  private dispatchSequenceClaims(key: string, kind: SalesDocumentNumberKind, scope: Scope): void {
    if (this.sequenceDispatching.has(key)) return
    const queue = this.sequenceQueues.get(key)
    if (!queue || queue.length === 0) return
    this.sequenceDispatching.add(key)
    const waiters = queue.splice(0, queue.length)
    void (async () => {
      try {
        const rows = await this.em.getConnection().execute<{ current_value: string }[]>(
          `
            insert into sales_document_sequences (id, organization_id, tenant_id, document_kind, current_value, created_at, updated_at)
            values (gen_random_uuid(), ?, ?, ?, ?, now(), now())
            on conflict (organization_id, tenant_id, document_kind)
            do update set current_value = sales_document_sequences.current_value + ?, updated_at = now()
            returning current_value
          `,
          [scope.organizationId, scope.tenantId, kind, waiters.length, waiters.length]
        )
        const claimedUpTo = Number(rows?.[0]?.current_value ?? DEFAULT_SEQUENCE_START)
        const lastValue =
          !Number.isFinite(claimedUpTo) || claimedUpTo < DEFAULT_SEQUENCE_START
            ? DEFAULT_SEQUENCE_START
            : Math.min(claimedUpTo, MAX_SEQUENCE)
        const firstValue = Math.max(lastValue - waiters.length + 1, DEFAULT_SEQUENCE_START)
        waiters.forEach((waiter, index) => waiter.resolve(Math.min(firstValue + index, MAX_SEQUENCE)))
      } catch (error) {
        waiters.forEach((waiter) => waiter.reject(error))
      } finally {
        this.sequenceDispatching.delete(key)
        this.dispatchSequenceClaims(key, kind, scope)
      }
    })()
  }

  private formatNumber(
    template: string,
    context: { kind: SalesDocumentNumberKind; sequence: number; date: Date; guid?: string | null }
  ): string {
    const source =
      template?.trim() ||
      (context.kind === 'order'
        ? DEFAULT_ORDER_NUMBER_FORMAT
        : context.kind === 'quote'
          ? DEFAULT_QUOTE_NUMBER_FORMAT
          : DEFAULT_RETURN_NUMBER_FORMAT)
    const now = context.date
    return source.replace(/\{([a-zA-Z]+)(?::([^}]+))?\}/g, (match, rawToken, rawArg) => {
      const token = rawToken.toLowerCase()
      const arg = typeof rawArg === 'string' ? rawArg.trim() : ''
      switch (token) {
        case 'yyyy':
          return String(now.getFullYear())
        case 'yy':
          return String(now.getFullYear()).slice(-2)
        case 'mm':
          return String(now.getMonth() + 1).padStart(2, '0')
        case 'dd':
          return String(now.getDate()).padStart(2, '0')
        case 'hh':
          return String(now.getHours()).padStart(2, '0')
        case 'seq': {
          const requested = parseInt(arg || '', 10)
          const width = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 12) : undefined
          return width ? String(context.sequence).padStart(width, '0') : String(context.sequence)
        }
        case 'rand': {
          const requested = parseInt(arg || '', 10)
          const length = Number.isFinite(requested) && requested > 0 ? requested : 4
          return generateRandomDigits(length)
        }
        case 'guid':
          return context.guid || randomUUID()
        case 'nanoid': {
          const requested = parseInt(arg || '', 10)
          const size =
            Number.isFinite(requested) && requested > 0 ? Math.min(requested, 32) : 12
          return createNanoId(size)
        }
        case 'kind':
          return context.kind
        default:
          return match
      }
    })
  }
}
