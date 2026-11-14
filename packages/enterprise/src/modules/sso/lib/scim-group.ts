import { z } from 'zod'
import type { ScimGroup } from '../data/entities'

const memberSchema = z.object({
  value: z.string().uuid(),
}).passthrough()

export const scimGroupPayloadSchema = z.object({
  schemas: z.array(z.string()).optional(),
  externalId: z.string().min(1).max(512).optional(),
  displayName: z.string().trim().min(1).max(255),
  members: z.array(memberSchema).max(100).default([]),
}).passthrough()

export type ScimGroupPayload = z.infer<typeof scimGroupPayloadSchema>

export interface ScimGroupPatchOperation {
  op: 'add' | 'replace' | 'remove'
  path?: string
  value?: unknown
}

export interface ScimGroupResource {
  schemas: string[]
  id: string
  externalId?: string
  displayName: string
  members: Array<{ value: string; $ref: string; type: 'User' }>
  meta: {
    resourceType: 'Group'
    created: string
    lastModified: string
    location: string
  }
}

export function parseScimGroupPatchOperations(body: Record<string, unknown>): ScimGroupPatchOperation[] {
  const rawOperations = body.Operations ?? body.operations
  if (!Array.isArray(rawOperations) || rawOperations.length === 0) {
    throw new ScimGroupInputError('PatchOp body must contain Operations array')
  }
  if (rawOperations.length > 100) {
    throw new ScimGroupInputError('PatchOp cannot contain more than 100 operations')
  }

  return rawOperations.map((rawOperation) => {
    if (!rawOperation || typeof rawOperation !== 'object') {
      throw new ScimGroupInputError('Each PatchOp operation must be an object')
    }
    const candidate = rawOperation as Record<string, unknown>
    const op = String(candidate.op ?? '').toLowerCase()
    if (op !== 'add' && op !== 'replace' && op !== 'remove') {
      throw new ScimGroupInputError(`Unsupported group PatchOp: ${String(candidate.op ?? '')}`)
    }
    const normalizedOp: ScimGroupPatchOperation['op'] = op
    const path = typeof candidate.path === 'string' ? candidate.path : undefined
    if (path && !isSupportedGroupPath(path)) {
      return { op: normalizedOp, path, value: undefined }
    }
    return { op: normalizedOp, path, value: candidate.value }
  }).filter((operation) => operation.value !== undefined || operation.op === 'remove')
}

export function extractPatchMemberIds(operation: ScimGroupPatchOperation): string[] {
  const pathMember = operation.path ? extractMemberIdFromPath(operation.path) : null
  if (pathMember) return [pathMember]

  const rawValue = operation.value
  const values = Array.isArray(rawValue) ? rawValue : rawValue ? [rawValue] : []
  const memberIds = new Set<string>()
  for (const value of values) {
    if (!value || typeof value !== 'object') continue
    const memberId = (value as Record<string, unknown>).value
    if (typeof memberId === 'string' && z.string().uuid().safeParse(memberId).success) {
      memberIds.add(memberId)
    }
  }
  return Array.from(memberIds)
}

export function parseScimGroupFilter(filter: string | null):
  | { field: 'displayName' | 'externalId' | 'members.value'; value: string }
  | null {
  if (!filter) return null
  const match = filter.match(/^\s*(displayName|externalId|members\.value)\s+eq\s+(["'])(.*?)\2\s*$/i)
  if (!match) throw new ScimGroupInputError('Unsupported group filter')
  const normalized = match[1]!.toLowerCase()
  const field = normalized === 'displayname'
    ? 'displayName'
    : normalized === 'externalid'
      ? 'externalId'
      : 'members.value'
  return { field, value: match[3]! }
}

export function toScimGroupResource(
  group: ScimGroup,
  memberIds: string[],
  baseUrl: string,
): ScimGroupResource {
  const location = `${baseUrl}/api/sso/scim/v2/Groups/${group.id}`
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
    id: group.id,
    ...(group.externalId ? { externalId: group.externalId } : {}),
    displayName: group.displayName,
    members: memberIds.map((memberId) => ({
      value: memberId,
      $ref: `${baseUrl}/api/sso/scim/v2/Users/${memberId}`,
      type: 'User',
    })),
    meta: {
      resourceType: 'Group',
      created: group.createdAt.toISOString(),
      lastModified: group.updatedAt.toISOString(),
      location,
    },
  }
}

export class ScimGroupInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScimGroupInputError'
  }
}

function isSupportedGroupPath(path: string): boolean {
  const normalized = path.trim().toLowerCase()
  return normalized === 'displayname' || normalized === 'externalid' || normalized === 'members' || extractMemberIdFromPath(path) !== null
}

function extractMemberIdFromPath(path: string): string | null {
  const match = path.match(/^\s*members\s*\[\s*value\s+eq\s+(["'])([0-9a-f-]+)\1\s*\]\s*$/i)
  if (!match) return null
  return z.string().uuid().safeParse(match[2]).success ? match[2]! : null
}
