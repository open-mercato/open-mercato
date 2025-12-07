import { randomBytes, randomUUID } from 'crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesDocumentSequence, SalesSettings } from '../data/entities'
import {
  DEFAULT_ORDER_NUMBER_FORMAT,
  DEFAULT_QUOTE_NUMBER_FORMAT,
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
}

const MAX_SEQUENCE = 1_000_000_000
const DEFAULT_SEQUENCE_START = 1

const createNanoId = (size = 12) => {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  const bytes = randomBytes(Math.max(1, Math.min(size, 64)))
  let id = ''
  for (let i = 0; i < bytes.length && id.length < size; i += 1) {
    id += alphabet[bytes[i] % alphabet.length]
  }
  return id
}

const generateRandomDigits = (size = 4) => {
  const length = Math.max(1, Math.min(size, 12))
  const digits = []
  const bytes = randomBytes(length)
  for (let i = 0; i < length; i += 1) {
    digits.push((bytes[i] % 10).toString())
  }
  return digits.join('')
}

export class SalesDocumentNumberGenerator {
  constructor(private readonly em: EntityManager) {}

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
    const [order, quote] = await Promise.all([
      this.peekNextSequence('order', scope),
      this.peekNextSequence('quote', scope),
    ])
    return { order, quote }
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
      (params.kind === 'order' ? settings.orderNumberFormat : settings.quoteNumberFormat)
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

  private async claimSequence(kind: SalesDocumentNumberKind, scope: Scope): Promise<number> {
    const rows = await this.em.getConnection().execute<{ current_value: string }[]>(
      `
        insert into sales_document_sequences (id, organization_id, tenant_id, document_kind, current_value, created_at, updated_at)
        values (gen_random_uuid(), ?, ?, ?, ?, now(), now())
        on conflict (organization_id, tenant_id, document_kind)
        do update set current_value = sales_document_sequences.current_value + 1, updated_at = now()
        returning current_value
      `,
      [scope.organizationId, scope.tenantId, kind, DEFAULT_SEQUENCE_START]
    )
    const value = Number(rows?.[0]?.current_value ?? DEFAULT_SEQUENCE_START)
    if (!Number.isFinite(value) || value < DEFAULT_SEQUENCE_START) return DEFAULT_SEQUENCE_START
    return Math.min(value, MAX_SEQUENCE)
  }

  private formatNumber(
    template: string,
    context: { kind: SalesDocumentNumberKind; sequence: number; date: Date; guid?: string | null }
  ): string {
    const source =
      template?.trim() ||
      (context.kind === 'order' ? DEFAULT_ORDER_NUMBER_FORMAT : DEFAULT_QUOTE_NUMBER_FORMAT)
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
