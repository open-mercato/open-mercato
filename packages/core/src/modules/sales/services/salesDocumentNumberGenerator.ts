import { randomBytes, randomUUID } from 'crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesSettings } from '../data/entities'
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

// Each (organization, tenant, kind) scope is backed by its own Postgres sequence, named
// after the `sales_document_sequences` registry row that owns it (#5604). Deriving the name
// from the row's primary key keeps the mapping recomputable from the table alone — no extra
// column, and `\ds sales_docseq_*` in psql lines up with the registry.
const SEQUENCE_NAME_PREFIX = 'sales_docseq_'
const SEQUENCE_NAME_PATTERN = /^sales_docseq_[0-9a-f]{32}$/
// Recomputes the name in SQL so a claim is a single round trip: look the registry row up by
// its unique scope index and call `nextval` on the sequence that row names.
const SEQUENCE_REGCLASS_SQL = `('${SEQUENCE_NAME_PREFIX}' || replace(id::text, '-', ''))::regclass`
const SEQUENCE_SCOPE_PREDICATE = 'organization_id = ? and tenant_id = ? and document_kind = ?'

export function documentSequenceName(registryId: string): string {
  const name = `${SEQUENCE_NAME_PREFIX}${String(registryId).replace(/-/g, '').toLowerCase()}`
  if (!SEQUENCE_NAME_PATTERN.test(name)) {
    throw new Error('[internal] Document-sequence registry id is not a UUID')
  }
  return name
}

function isMissingRelationError(error: unknown): boolean {
  if ((error as { code?: unknown } | null)?.code === '42P01') return true
  const message = error instanceof Error ? error.message : ''
  return /does not exist/i.test(message)
}

function isDuplicateRelationError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  if (code === '42P07' || code === '23505') return true
  const message = error instanceof Error ? error.message : ''
  return /already exists/i.test(message)
}

/**
 * Creates the Postgres sequence backing a `sales_document_sequences` registry row, if it is
 * not there yet. Safe to call concurrently: `if not exists` still races on `pg_class`, so a
 * duplicate error means another caller won and is treated as success.
 */
export async function createDocumentSequence(em: EntityManager, registryId: string): Promise<void> {
  const name = documentSequenceName(registryId)
  try {
    await em.getConnection().execute(
      `create sequence if not exists "${name}" as bigint minvalue ${DEFAULT_SEQUENCE_START} start with ${DEFAULT_SEQUENCE_START} no cycle`,
      [],
      'run'
    )
  } catch (error) {
    if (!isDuplicateRelationError(error)) throw error
  }
}

/** Backfills the sequences for every registry row already present in a scope. */
export async function ensureDocumentSequencesForScope(em: EntityManager, scope: Scope): Promise<void> {
  const rows = await em.getConnection().execute<{ id: string }[]>(
    'select id from sales_document_sequences where organization_id = ? and tenant_id = ?',
    [scope.organizationId, scope.tenantId]
  )
  for (const row of rows ?? []) {
    await createDocumentSequence(em, row.id)
  }
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
    const [order, quote, salesReturn] = await Promise.all([
      this.peekNextSequence('order', scope),
      this.peekNextSequence('quote', scope),
      this.peekNextSequence('return', scope),
    ])
    return { order, quote, return: salesReturn }
  }

  async setNextSequence(kind: SalesDocumentNumberKind, scope: Scope, nextValue: number): Promise<void> {
    const next = Math.min(Math.max(Math.floor(nextValue), DEFAULT_SEQUENCE_START), MAX_SEQUENCE)
    await this.ensureSequence(kind, scope)
    // `is_called = false` makes the next `nextval` return exactly `next`.
    await this.em.getConnection().execute(
      `
        select setval(${SEQUENCE_REGCLASS_SQL}, ?, false)
          from sales_document_sequences
         where ${SEQUENCE_SCOPE_PREDICATE}
      `,
      [next, scope.organizationId, scope.tenantId, kind]
    )
    await this.em.getConnection().execute(
      `
        update sales_document_sequences
           set current_value = ?, updated_at = now()
         where ${SEQUENCE_SCOPE_PREDICATE}
      `,
      [next - 1, scope.organizationId, scope.tenantId, kind],
      'run'
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
    let rows: { last_value: string | number | null }[] | undefined
    try {
      // `pg_sequence_last_value` reports the sequence's state without consuming a value, and
      // returns NULL for a sequence `nextval` has never touched.
      rows = await this.em.getConnection().execute<{ last_value: string | number | null }[]>(
        `
          select pg_sequence_last_value(${SEQUENCE_REGCLASS_SQL}) as last_value
            from sales_document_sequences
           where ${SEQUENCE_SCOPE_PREDICATE}
        `,
        [scope.organizationId, scope.tenantId, kind]
      )
    } catch (error) {
      if (isMissingRelationError(error)) return DEFAULT_SEQUENCE_START
      throw error
    }
    const lastValue = rows?.[0]?.last_value
    if (lastValue == null) return DEFAULT_SEQUENCE_START
    const value = Number(lastValue)
    if (!Number.isFinite(value)) return DEFAULT_SEQUENCE_START
    return Math.min(Math.max(value + 1, DEFAULT_SEQUENCE_START), MAX_SEQUENCE)
  }

  // `nextval` is the whole point of the sequence: it is atomic, never takes a row lock, and
  // produces no dead tuples, so concurrent claims for the same scope no longer serialize on a
  // single `sales_document_sequences` row the way the previous `UPDATE … current_value + 1`
  // did (#5604). The registry row still exists — it names the sequence and records the scope —
  // but the hot path only reads it.
  private async claimSequence(kind: SalesDocumentNumberKind, scope: Scope): Promise<number> {
    const claimed = await this.tryClaimSequence(kind, scope)
    if (claimed !== null) return claimed
    // First claim for this scope (or a tenant created before the sequences existed): create
    // the registry row and its sequence, then claim once more.
    await this.ensureSequence(kind, scope)
    const retried = await this.tryClaimSequence(kind, scope)
    if (retried === null) {
      throw new Error('[internal] Sales document sequence is missing immediately after being created')
    }
    return retried
  }

  private async tryClaimSequence(kind: SalesDocumentNumberKind, scope: Scope): Promise<number | null> {
    let rows: { claimed: string | number | null }[] | undefined
    try {
      rows = await this.em.getConnection().execute<{ claimed: string | number | null }[]>(
        `
          select nextval(${SEQUENCE_REGCLASS_SQL}) as claimed
            from sales_document_sequences
           where ${SEQUENCE_SCOPE_PREDICATE}
        `,
        [scope.organizationId, scope.tenantId, kind]
      )
    } catch (error) {
      if (isMissingRelationError(error)) return null
      throw error
    }
    const claimed = rows?.[0]?.claimed
    if (claimed == null) return null
    const value = Number(claimed)
    if (!Number.isFinite(value) || value < DEFAULT_SEQUENCE_START) {
      throw new Error('[internal] Sales document sequence returned a value below its start')
    }
    if (value > MAX_SEQUENCE) {
      // Never hand out a clamped value: two documents sharing a number is a worse failure
      // than refusing to issue one, and the caller's transaction can still roll back cleanly.
      throw new Error('[internal] Sales document sequence is exhausted')
    }
    return value
  }

  private async ensureSequence(kind: SalesDocumentNumberKind, scope: Scope): Promise<void> {
    const rows = await this.em.getConnection().execute<{ id: string }[]>(
      `
        insert into sales_document_sequences (id, organization_id, tenant_id, document_kind, current_value, created_at, updated_at)
        values (gen_random_uuid(), ?, ?, ?, 0, now(), now())
        on conflict (organization_id, tenant_id, document_kind)
        do update set updated_at = now()
        returning id
      `,
      [scope.organizationId, scope.tenantId, kind]
    )
    const registryId = rows?.[0]?.id
    if (!registryId) {
      throw new Error('[internal] Could not resolve a sales document sequence registry row')
    }
    await createDocumentSequence(this.em, registryId)
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
