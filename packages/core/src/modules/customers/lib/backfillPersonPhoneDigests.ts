import type { EntityManager } from '@mikro-orm/postgresql'
import { isEncryptedPayloadShape } from '@open-mercato/shared/lib/encryption/aes'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { hashPersonPhoneDigits, hasPersonPhoneLookupPepper } from './personPhoneLookup'

const BATCH_SIZE = 250

type PersonPhoneRow = {
  id: string
  tenant_id: string
  organization_id: string
  kind: string
  primary_phone: string | null
  primary_phone_digits_hash: string | null
}

type BackfillOptions = {
  tenantId: string
  organizationId: string
  dryRun: boolean
}

export async function backfillPersonPhoneDigests(
  em: EntityManager,
  encryption: Pick<TenantDataEncryptionService, 'decryptEntityPayload'>,
  { tenantId, organizationId, dryRun }: BackfillOptions,
): Promise<{ scanned: number; needsUpdate: number; updated: number; unreadable: number; conflicted: number }> {
  if (!hasPersonPhoneLookupPepper()) {
    throw new Error('[internal] Configure a keyed lookup secret before running the CRM phone backfill')
  }

  const db = em.getKysely<{ customer_entities: PersonPhoneRow }>()
  const stats = { scanned: 0, needsUpdate: 0, updated: 0, unreadable: 0, conflicted: 0 }
  let lastId: string | undefined

  for (;;) {
    let page = db.selectFrom('customer_entities')
      .select(['id', 'primary_phone', 'primary_phone_digits_hash'])
      .where('tenant_id', '=', tenantId)
      .where('organization_id', '=', organizationId)
      .where('kind', '=', 'person')
      .where((expr) => expr.or([
        expr('primary_phone', 'is not', null),
        expr('primary_phone_digits_hash', 'is not', null),
      ]))
      .orderBy('id')
      .limit(BATCH_SIZE)
    if (lastId) page = page.where('id', '>', lastId)
    const rows = await page.execute()
    if (rows.length === 0) return stats

    for (const row of rows) {
      stats.scanned += 1
      let phone = row.primary_phone
      if (isEncryptedPayloadShape(phone)) {
        const decrypted = await encryption.decryptEntityPayload(
          'customers:customer_entity', { primary_phone: phone }, tenantId, organizationId, { em },
        )
        const plaintext = decrypted?.primary_phone
        if (typeof plaintext !== 'string' || isEncryptedPayloadShape(plaintext)) {
          stats.unreadable += 1
          continue
        }
        phone = plaintext
      }

      const hash = hashPersonPhoneDigits(phone, organizationId)
      if (hash === row.primary_phone_digits_hash) continue
      stats.needsUpdate += 1
      if (dryRun) continue

      const result = await db.updateTable('customer_entities')
        .set({ primary_phone_digits_hash: hash })
        .where('id', '=', row.id)
        .where('tenant_id', '=', tenantId)
        .where('organization_id', '=', organizationId)
        .where('kind', '=', 'person')
        .where('primary_phone', 'is not distinct from', row.primary_phone)
        .where('primary_phone_digits_hash', 'is not distinct from', row.primary_phone_digits_hash)
        .executeTakeFirstOrThrow()
      if (result.numUpdatedRows > 0n) stats.updated += 1
      else stats.conflicted += 1
    }

    if (rows.length < BATCH_SIZE) return stats
    lastId = rows[rows.length - 1].id
  }
}
