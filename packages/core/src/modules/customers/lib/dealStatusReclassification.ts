import { createHash } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  DEAL_STATUS_RECLASSIFICATION_CODE,
  DEAL_STATUS_RECLASSIFICATION_HEADER,
  dealStatusReclassificationConfirmationSchema,
  dealStatusVocabularySchema,
} from '../data/dealStatusVocabulary'
import { getDealStatusAliases, isWonDealStatus, isLostDealStatus, isClosedDealStatus, type DealStatusVocabulary } from './dealStatus'
import { resolveDealStatusVocabulary } from './dealStatusVocabulary'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { NORMALIZED_DEAL_STATUS_SQL } from './dealStatusSql'

const statusCountsSchema = z.array(z.object({ status: z.string(), count: z.coerce.number().int().nonnegative().safe() }))
const OUTCOMES = ['won', 'lost', 'closed'] as const

function normalizeVocabulary(vocabulary: DealStatusVocabulary) {
  return OUTCOMES.map((outcome) => [outcome, vocabulary[outcome].map((alias) => alias.trim().toLowerCase())])
}

function classification(status: string, vocabulary: DealStatusVocabulary): string {
  if (isWonDealStatus(status, vocabulary)) return 'won'
  if (isLostDealStatus(status, vocabulary)) return 'lost'
  return isClosedDealStatus(status, vocabulary) ? 'closed' : 'open'
}

function classificationKey(vocabulary: DealStatusVocabulary): string {
  const aliases = getDealStatusAliases(vocabulary)
  return JSON.stringify(OUTCOMES.map((outcome) => Array.from(new Set(aliases[outcome].map((alias) => alias.trim().toLowerCase()))).sort((left, right) => left < right ? -1 : left > right ? 1 : 0)))
}

export async function enforceDealStatusReclassification(input: {
  em: EntityManager
  container: Pick<AppContainer, 'resolve'>
  tenantId: string
  userId: string
  updatedAt: string | null
  candidate: unknown
  confirmation?: { fingerprint: string }
  request?: Request
}): Promise<void> {
  const previous = (await resolveDealStatusVocabulary(input.container, input.tenantId)).vocabulary
  const parsed = dealStatusVocabularySchema.safeParse(input.candidate)
  const candidate = parsed.success ? parsed.data : (await resolveDealStatusVocabulary(undefined, input.tenantId)).vocabulary
  if (classificationKey(previous) === classificationKey(candidate)) return
  const statuses = Array.from(new Set([
    ...getDealStatusAliases(previous).terminal,
    ...getDealStatusAliases(candidate).terminal,
  ].map((status) => status.trim().toLowerCase())))
    .filter((status) => classification(status, previous) !== classification(status, candidate)).sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
  const placeholders = statuses.map(() => '?').join(', ')

  const rows = statusCountsSchema.parse(await input.em.getConnection().execute(
    `SELECT ${NORMALIZED_DEAL_STATUS_SQL} AS status, COUNT(*)::text AS count FROM customer_deals WHERE tenant_id = ? AND deleted_at IS NULL AND ${NORMALIZED_DEAL_STATUS_SQL} IN (${placeholders}) GROUP BY ${NORMALIZED_DEAL_STATUS_SQL} ORDER BY status`,
    [input.tenantId, ...statuses],
    'all',
    input.em.getTransactionContext(),
  ))
  const affected = rows.flatMap((row) => {
    const before = classification(row.status, previous)
    const after = classification(row.status, candidate)
    return before === after || row.count === 0 ? [] : [{ status: row.status, count: row.count, before, after }]
  }).sort((left, right) => left.status < right.status ? -1 : left.status > right.status ? 1 : 0)
  const affectedDeals = affected.reduce((count, row) => count + row.count, 0)
  if (!affectedDeals) return
  const fingerprint = createHash('sha256').update(JSON.stringify({
    tenantId: input.tenantId,
    userId: input.userId,
    permissionScope: 'tenant',
    updatedAt: input.updatedAt,
    previous: normalizeVocabulary(previous),
    candidate: normalizeVocabulary(candidate),
    affected,
  })).digest('hex')
  const header = input.request?.headers.get(DEAL_STATUS_RECLASSIFICATION_HEADER)
  const confirmation = header
    ? dealStatusReclassificationConfirmationSchema.safeParse({ fingerprint: header })
    : dealStatusReclassificationConfirmationSchema.safeParse(input.confirmation)
  if (confirmation.success && confirmation.data.fingerprint === fingerprint) return
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(409, {
    error: translate('customers.settings.dealStatusVocabulary.confirmationRequired', 'Confirm how this change affects existing deals before saving.'),
    code: DEAL_STATUS_RECLASSIFICATION_CODE,
    impact: { affectedDeals, fingerprint },
  })
}
