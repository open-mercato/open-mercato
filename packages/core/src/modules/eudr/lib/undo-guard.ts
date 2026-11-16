import { LockMode, type EntityName, type FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { snapshotsEqual } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export const UNDO_CONFLICT_CODE = 'eudr.errors.undoConflict'

type UndoTarget = {
  id: string
  tenantId: string
  organizationId: string
}

type UndoSnapshot = {
  createdAt: string
  updatedAt: string
  custom?: Record<string, unknown> | null
}

function isEmptyCustomValue(value: unknown): boolean {
  return value === null || value === undefined || (Array.isArray(value) && value.length === 0)
}

function normalizeCustomValue(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value
    .map((entry) => ({ entry, key: JSON.stringify(entry) }))
    .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
    .map(({ entry }) => entry)
}

function normalizeCustom(custom: unknown): Record<string, unknown> | null {
  if (!custom || typeof custom !== 'object') return null
  const entries = Object.entries(custom as Record<string, unknown>)
    .filter(([, value]) => !isEmptyCustomValue(value))
    .map(([key, value]) => [key, normalizeCustomValue(value)] as const)
  return entries.length ? Object.fromEntries(entries) : null
}

function comparableContent(snapshot: UndoSnapshot): Record<string, unknown> {
  const { createdAt: _createdAt, updatedAt: _updatedAt, custom, ...content } = JSON.parse(
    JSON.stringify(snapshot),
  ) as UndoSnapshot & Record<string, unknown>
  return { ...content, custom: normalizeCustom(custom) }
}

export function isUnchangedSince(current: UndoSnapshot, expected: UndoSnapshot): boolean {
  return snapshotsEqual(comparableContent(current), comparableContent(expected))
}

export async function throwUndoConflict(): Promise<never> {
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(409, {
    error: translate(UNDO_CONFLICT_CODE, 'This record changed after the action you are undoing. Undo was refused.'),
    code: UNDO_CONFLICT_CODE,
  })
}

export async function lockForUndo<T extends object>(
  em: EntityManager,
  entityName: EntityName<T>,
  target: UndoTarget,
): Promise<T | null> {
  const { id, tenantId, organizationId } = target
  return findOneWithDecryption(
    em,
    entityName,
    { id, tenantId, organizationId } as FilterQuery<T>,
    { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
    { tenantId, organizationId },
  )
}
