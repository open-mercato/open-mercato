import type { CatalogCategorizationService } from './categorizationService'

export async function isAiCategorizationEffectiveForTenant(
  tenantId: string | null | undefined,
): Promise<boolean> {
  if (!tenantId) return false
  try {
    const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
    const container = await createRequestContainer()
    const service = container.resolve('catalogCategorizationService') as CatalogCategorizationService
    const status = await service.getStatus({ tenantId })
    return status.effective === true
  } catch {
    return false
  }
}
