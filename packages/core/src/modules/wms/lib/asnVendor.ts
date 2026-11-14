import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { E } from '#generated/entities.ids.generated'

type VendorLookupScope = {
  tenantId: string
  organizationId: string
}

type VendorLookupContainer = {
  resolve: (name: string) => unknown
}

/**
 * True when the failure indicates the optional `customers` peer (or query
 * engine) is absent from the deployment — not a transient lookup failure.
 * Transient errors must NOT be treated as "vendor OK".
 */
export function isOptionalCustomersPeerAbsentError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = String((error as { name?: string }).name ?? '')
  const message = String((error as { message?: string }).message ?? '')
  if (name === 'AwilixResolutionError') return true
  if (/Could not resolve ['"]?queryEngine['"]?/i.test(message)) return true
  if (
    /unknown entity|entity id .+ not (found|registered)|no entity metadata for|entity .+ is not registered/i.test(
      message,
    )
  ) {
    return true
  }
  return false
}

function mapVendorLookupFailure(error: unknown): CrudHttpError {
  if (error instanceof CrudHttpError) return error
  return new CrudHttpError(503, { error: 'vendor_lookup_unavailable' })
}

/**
 * When `vendorId` is set and the customers peer is available, require a
 * matching customer entity in scope. Skip only when the peer is absent;
 * re-throw / map other failures so invalid vendors are not silently accepted.
 */
export async function requireVendorIfPresent(
  container: VendorLookupContainer,
  vendorId: string | null | undefined,
  scope: VendorLookupScope,
): Promise<void> {
  if (!vendorId) return
  const customerEntityId = (
    E as { customers?: { customer_entity?: string } }
  ).customers?.customer_entity
  if (!customerEntityId) return

  let queryEngine: QueryEngine
  try {
    queryEngine = container.resolve('queryEngine') as QueryEngine
  } catch (error) {
    if (isOptionalCustomersPeerAbsentError(error)) return
    throw mapVendorLookupFailure(error)
  }

  try {
    const result = await queryEngine.query<{ id?: string }>(customerEntityId, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      filters: { id: { $eq: vendorId } },
      fields: ['id'],
      page: { page: 1, pageSize: 1 },
    })
    if (!result.items[0]?.id) {
      throw new CrudHttpError(422, { error: 'invalid_vendor' })
    }
  } catch (error) {
    if (error instanceof CrudHttpError) throw error
    if (isOptionalCustomersPeerAbsentError(error)) return
    throw mapVendorLookupFailure(error)
  }
}
