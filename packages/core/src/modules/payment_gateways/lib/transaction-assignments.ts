import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { GatewayTransaction, GatewayTransactionAssignment } from '../data/entities'

export type GatewayTransactionAssignmentInput = {
  entityType: string
  entityId: string
}

type Scope = {
  organizationId: string
  tenantId: string
}

function normalizeAssignmentValue(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function buildAssignmentKey(input: GatewayTransactionAssignmentInput): string {
  return `${input.entityType}::${input.entityId}`
}

export function normalizeGatewayTransactionAssignments(input: {
  assignments?: ReadonlyArray<GatewayTransactionAssignmentInput> | null
  documentType?: string | null
  documentId?: string | null
}): GatewayTransactionAssignmentInput[] {
  const normalized: GatewayTransactionAssignmentInput[] = []
  const seen = new Set<string>()

  const push = (candidate: GatewayTransactionAssignmentInput | null) => {
    if (!candidate) return
    const entityType = normalizeAssignmentValue(candidate.entityType)
    const entityId = normalizeAssignmentValue(candidate.entityId)
    if (!entityType || !entityId) return
    const assignment = { entityType, entityId }
    const key = buildAssignmentKey(assignment)
    if (seen.has(key)) return
    seen.add(key)
    normalized.push(assignment)
  }

  if (Array.isArray(input.assignments)) {
    input.assignments.forEach((assignment) => push(assignment))
  }

  const legacyEntityType = normalizeAssignmentValue(input.documentType)
  const legacyEntityId = normalizeAssignmentValue(input.documentId)
  if (legacyEntityType && legacyEntityId) {
    push({ entityType: legacyEntityType, entityId: legacyEntityId })
  }

  return normalized
}

export function readPrimaryGatewayTransactionAssignment(
  assignments: ReadonlyArray<GatewayTransactionAssignmentInput>,
): GatewayTransactionAssignmentInput | null {
  return assignments.length > 0 ? assignments[0] ?? null : null
}

function syncLegacyDocumentBridge(
  transaction: GatewayTransaction,
  assignments: ReadonlyArray<GatewayTransactionAssignmentInput>,
) {
  const primary = readPrimaryGatewayTransactionAssignment(assignments)
  transaction.documentType = primary?.entityType ?? null
  transaction.documentId = primary?.entityId ?? null
}

export async function listGatewayTransactionAssignments(
  em: EntityManager,
  {
    transactionIds,
    scope,
  }: {
    transactionIds: ReadonlyArray<string>
    scope: Scope
  },
): Promise<Map<string, GatewayTransactionAssignment[]>> {
  const ids = transactionIds
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0)

  if (ids.length === 0) return new Map()

  const rows = await findWithDecryption(
    em,
    GatewayTransactionAssignment,
    {
      transactionId: { $in: ids },
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    },
    {
      orderBy: {
        createdAt: 'asc',
        id: 'asc',
      },
    },
    scope,
  )

  const grouped = new Map<string, GatewayTransactionAssignment[]>()
  rows.forEach((row) => {
    const bucket = grouped.get(row.transactionId) ?? []
    bucket.push(row)
    grouped.set(row.transactionId, bucket)
  })
  return grouped
}

export async function replaceGatewayTransactionAssignments(
  em: EntityManager,
  {
    transaction,
    assignments,
    scope,
  }: {
    transaction: GatewayTransaction
    assignments: ReadonlyArray<GatewayTransactionAssignmentInput>
    scope: Scope
  },
): Promise<GatewayTransactionAssignment[]> {
  const normalizedAssignments = normalizeGatewayTransactionAssignments({ assignments })
  const existingAssignments = await findWithDecryption(
    em,
    GatewayTransactionAssignment,
    {
      transactionId: transaction.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    },
    {
      orderBy: {
        createdAt: 'asc',
        id: 'asc',
      },
    },
    scope,
  )

  const desiredKeys = new Set(normalizedAssignments.map(buildAssignmentKey))
  const existingByKey = new Map(
    existingAssignments.map((assignment) => [
      buildAssignmentKey({ entityType: assignment.entityType, entityId: assignment.entityId }),
      assignment,
    ]),
  )

  const toRemove = existingAssignments.filter(
    (assignment) => !desiredKeys.has(buildAssignmentKey({ entityType: assignment.entityType, entityId: assignment.entityId })),
  )
  if (toRemove.length > 0) {
    em.remove(toRemove)
  }

  normalizedAssignments.forEach((assignment) => {
    const key = buildAssignmentKey(assignment)
    if (existingByKey.has(key)) return
    em.persist(em.create(GatewayTransactionAssignment, {
      transactionId: transaction.id,
      entityType: assignment.entityType,
      entityId: assignment.entityId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    }))
  })

  syncLegacyDocumentBridge(transaction, normalizedAssignments)
  await em.flush()

  return findWithDecryption(
    em,
    GatewayTransactionAssignment,
    {
      transactionId: transaction.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    },
    {
      orderBy: {
        createdAt: 'asc',
        id: 'asc',
      },
    },
    scope,
  )
}

export async function assignGatewayTransaction(
  em: EntityManager,
  {
    transaction,
    assignment,
    scope,
  }: {
    transaction: GatewayTransaction
    assignment: GatewayTransactionAssignmentInput
    scope: Scope
  },
): Promise<GatewayTransactionAssignment[]> {
  const existingAssignments = await listGatewayTransactionAssignments(em, {
    transactionIds: [transaction.id],
    scope,
  })

  return replaceGatewayTransactionAssignments(em, {
    transaction,
    assignments: [
      ...((existingAssignments.get(transaction.id) ?? []).map((row) => ({
        entityType: row.entityType,
        entityId: row.entityId,
      }))),
      assignment,
    ],
    scope,
  })
}

export async function deassignGatewayTransaction(
  em: EntityManager,
  {
    transaction,
    assignment,
    scope,
  }: {
    transaction: GatewayTransaction
    assignment: GatewayTransactionAssignmentInput
    scope: Scope
  },
): Promise<GatewayTransactionAssignment[]> {
  const normalizedAssignment = normalizeGatewayTransactionAssignments({ assignments: [assignment] })[0] ?? null
  const existingAssignments = await listGatewayTransactionAssignments(em, {
    transactionIds: [transaction.id],
    scope,
  })

  const nextAssignments = (existingAssignments.get(transaction.id) ?? [])
    .map((row) => ({
      entityType: row.entityType,
      entityId: row.entityId,
    }))
    .filter((row) => {
      if (!normalizedAssignment) return true
      return !(row.entityType === normalizedAssignment.entityType && row.entityId === normalizedAssignment.entityId)
    })

  return replaceGatewayTransactionAssignments(em, {
    transaction,
    assignments: nextAssignments,
    scope,
  })
}
