import { sanitizeDocumentsDisplayLabel } from '../../../lib/displayLabels'

export type DocumentSharePrincipalType = 'user' | 'role'
export type DocumentSharePermission = 'viewer' | 'commenter' | 'editor'

export type ShareRow = {
  id: string
  principalType: DocumentSharePrincipalType
  principalId: string
  principalLabel: string
  principalSecondary: string | null
  resolved: boolean
  permission: DocumentSharePermission
  updatedAt?: string | null
}

export type SharesResponse = {
  items?: unknown[]
  data?: unknown[]
  shares?: unknown[]
}

export const SHARE_PERMISSIONS: DocumentSharePermission[] = ['viewer', 'commenter', 'editor']
export const PRINCIPAL_TYPES: DocumentSharePrincipalType[] = ['user', 'role']

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return null
}

export function readPrincipalType(value: string | null): DocumentSharePrincipalType {
  return value === 'role' ? 'role' : 'user'
}

export function readPermission(value: string | null): DocumentSharePermission {
  if (value === 'commenter' || value === 'editor') return value
  return 'viewer'
}

function normalizeShare(value: unknown, removedPrincipalLabel: string): ShareRow | null {
  const record = readRecord(value)
  if (!record) return null
  const id = readString(record, 'id')
  const principalId = readString(record, 'principalId', 'principal_id')
  if (!id || !principalId) return null
  const principalType = readPrincipalType(readString(record, 'principalType', 'principal_type'))
  const permission = readPermission(readString(record, 'permission', 'tier'))
  const resolvedLabel = sanitizeDocumentsDisplayLabel(
    readString(
      record,
      'principalLabel',
      'principal_label',
      'principalEmail',
      'principal_email',
      'name',
      'email',
    ),
  )
  const rawSecondary = readString(record, 'principalSecondary', 'principal_secondary')
  const principalSecondary = sanitizeDocumentsDisplayLabel(rawSecondary)
  return {
    id,
    principalId,
    principalType,
    principalLabel: resolvedLabel ?? removedPrincipalLabel,
    principalSecondary,
    resolved: resolvedLabel !== null,
    permission,
    updatedAt: readString(record, 'updatedAt', 'updated_at'),
  }
}

export function readShareItems(
  payload: SharesResponse | unknown[] | null,
  removedPrincipalLabel: string,
): ShareRow[] {
  const source = Array.isArray(payload)
    ? payload
    : (() => {
        const record = readRecord(payload)
        if (!record) return []
        return [record.items, record.data, record.shares].find(Array.isArray) ?? []
      })()
  return source
    .map((row) => normalizeShare(row, removedPrincipalLabel))
    .filter((row): row is ShareRow => row !== null)
}
