import { ScimService } from './scimService'
import { ScimGroupService } from './scimGroupService'
import { parseScimPatchOperations } from '../lib/scim-patch'
import { parseScimGroupPatchOperations, scimGroupPayloadSchema } from '../lib/scim-group'
import { scimUserPayloadSchema } from '../data/validators'
import type { ScimScope } from '../api/scim/context'

const BULK_RESPONSE_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:BulkResponse'

interface BulkOperation {
  method: string
  path: string
  bulkId?: string
  data?: unknown
}

interface BulkOperationResult {
  method: string
  bulkId?: string
  location?: string
  status: string
  response?: Record<string, unknown>
}

export class ScimBulkService {
  constructor(
    private scimService: ScimService,
    private scimGroupService: ScimGroupService,
  ) {}

  async execute(
    operations: BulkOperation[],
    scope: ScimScope,
    baseUrl: string,
    failOnErrors: number,
  ): Promise<Record<string, unknown>> {
    const results: BulkOperationResult[] = []
    const bulkIds = new Map<string, string>()
    let errors = 0

    for (const operation of operations) {
      if (failOnErrors > 0 && errors >= failOnErrors) break
      const resolved = resolveBulkReferences(operation, bulkIds)
      try {
        const result = await this.executeOne(resolved, scope, baseUrl)
        results.push({
          method: operation.method,
          ...(operation.bulkId ? { bulkId: operation.bulkId } : {}),
          ...result,
        })
        if (operation.bulkId && result.resourceId) bulkIds.set(operation.bulkId, result.resourceId)
      } catch (error) {
        errors += 1
        results.push({
          method: operation.method,
          ...(operation.bulkId ? { bulkId: operation.bulkId } : {}),
          status: String(resolveErrorStatus(error)),
          response: {
            schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
            detail: error instanceof Error ? error.message : 'Bulk operation failed',
            status: String(resolveErrorStatus(error)),
          },
        })
      }
    }

    return { schemas: [BULK_RESPONSE_SCHEMA], Operations: results }
  }

  private async executeOne(
    operation: BulkOperation,
    scope: ScimScope,
    baseUrl: string,
  ): Promise<{ status: string; location?: string; resourceId?: string }> {
    const method = operation.method.toUpperCase()
    const path = normalizePath(operation.path)

    if (method === 'POST' && path === '/Users') {
      const parsed = scimUserPayloadSchema.parse(operation.data)
      const { resource, status } = await this.scimService.createUser(parsed, scope, baseUrl)
      return { status: String(status), location: resource.meta.location, resourceId: resource.id }
    }
    if (method === 'POST' && path === '/Groups') {
      const parsed = scimGroupPayloadSchema.parse(operation.data)
      const resource = await this.scimGroupService.createGroup(parsed, scope, baseUrl)
      return { status: '201', location: resource.meta.location, resourceId: resource.id }
    }

    const match = path.match(/^\/(Users|Groups)\/([0-9a-f-]+)$/i)
    if (!match) throw new ScimBulkServiceError(400, 'Unsupported bulk operation path')
    const resourceType = match[1]!.toLowerCase()
    const resourceId = match[2]!

    if (resourceType === 'users' && method === 'PATCH') {
      await this.scimService.patchUser(resourceId, parseScimPatchOperations(asRecord(operation.data)), scope, baseUrl)
      return { status: '200', location: `${baseUrl}/api/sso/scim/v2/Users/${resourceId}`, resourceId }
    }
    if (resourceType === 'groups' && method === 'PATCH') {
      await this.scimGroupService.patchGroup(resourceId, parseScimGroupPatchOperations(asRecord(operation.data)), scope, baseUrl)
      return { status: '200', location: `${baseUrl}/api/sso/scim/v2/Groups/${resourceId}`, resourceId }
    }
    if (resourceType === 'users' && method === 'DELETE') {
      await this.scimService.deleteUser(resourceId, scope)
      return { status: '204' }
    }
    if (resourceType === 'groups' && method === 'DELETE') {
      await this.scimGroupService.deleteGroup(resourceId, scope)
      return { status: '204' }
    }

    throw new ScimBulkServiceError(400, 'Unsupported bulk operation')
  }
}

export class ScimBulkServiceError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message)
    this.name = 'ScimBulkServiceError'
  }
}

function resolveBulkReferences(operation: BulkOperation, bulkIds: Map<string, string>): BulkOperation {
  const serialized = JSON.stringify(operation)
  const replaced = serialized.replace(/bulkId:([A-Za-z0-9._-]+)/g, (value, bulkId: string) => bulkIds.get(bulkId) ?? value)
  return JSON.parse(replaced) as BulkOperation
}

function normalizePath(path: string): string {
  const withoutBase = path.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/api\/sso\/scim\/v2/i, '')
  return withoutBase.startsWith('/') ? withoutBase : `/${withoutBase}`
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ScimBulkServiceError(400, 'Bulk operation data must be an object')
  }
  return value as Record<string, unknown>
}

function resolveErrorStatus(error: unknown): number {
  if (error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number') return error.statusCode
  if (error && typeof error === 'object' && 'name' in error && error.name === 'ZodError') return 400
  return 500
}
