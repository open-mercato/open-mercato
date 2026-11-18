import { isTenantDataEncryptionEnabled } from '@open-mercato/shared/lib/encryption/toggles'
import { SalesOrder, SalesQuote } from '@open-mercato/core/modules/sales/data/entities'
import { FakeEm, type EntityClass, type Row, type Where } from './fakeEm'

const CIPHER_PREFIX = 'enc:v1:'
const ENCRYPTED_FIELDS: Record<string, readonly string[]> = {
  SalesOrder: ['metadata'],
  SalesQuote: ['metadata'],
}

export function encryptStoredValue(value: unknown): unknown {
  if (!isTenantDataEncryptionEnabled() || value === null || value === undefined) return value
  return `${CIPHER_PREFIX}${Buffer.from(JSON.stringify(value)).toString('base64')}`
}

function decryptStoredValue(value: unknown): unknown {
  if (typeof value !== 'string' || !value.startsWith(CIPHER_PREFIX)) return value
  return JSON.parse(Buffer.from(value.slice(CIPHER_PREFIX.length), 'base64').toString('utf8'))
}

function decryptedCopy(entity: EntityClass, row: Row): Row {
  const fields = ENCRYPTED_FIELDS[entity.name] ?? []
  if (!fields.length || !isTenantDataEncryptionEnabled()) return row
  const copy = Object.assign(Object.create(Object.getPrototypeOf(row)), row) as Row
  for (const field of fields) copy[field] = decryptStoredValue(row[field])
  return copy
}

type FindOptions = Parameters<FakeEm['find']>[2]

export function encryptingFindMock() {
  return {
    findWithDecryption: async (em: FakeEm, entity: EntityClass, where: Where, options?: FindOptions) =>
      (await em.find(entity, where, options)).map((row) => decryptedCopy(entity, row)),
    findOneWithDecryption: async (em: FakeEm, entity: EntityClass, where: Where, options?: FindOptions) => {
      const row = await em.findOne(entity, where, options)
      return row ? decryptedCopy(entity, row) : row
    },
  }
}

export type StoredSalesDocument = {
  id: string
  organizationId: string
  tenantId: string
  createdAt: Date
  metadata?: Record<string, unknown> | null
  channelId?: string | null
  customerEntityId?: string | null
  deletedAt?: Date | null
}

export function storeSalesDocument(em: FakeEm, kind: 'order' | 'quote', document: StoredSalesDocument): Row {
  const entity = kind === 'order' ? SalesOrder : SalesQuote
  return em.seed(entity, {
    channelId: null,
    customerEntityId: null,
    deletedAt: null,
    ...document,
    metadata: encryptStoredValue(document.metadata ?? null),
  } as Row)
}
