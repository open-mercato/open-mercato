import { match } from 'ts-pattern'
import { inpostRequest, resolveOrganizationId } from './client'

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy'
  message: string
  details: Record<string, unknown>
  checkedAt: Date
}

type InpostOrganization = {
  id: string
  name?: string
  [key: string]: unknown
}

export const inpostHealthCheck = {
  async check(credentials: Record<string, unknown>): Promise<HealthCheckResult> {
    try {
      const orgId = resolveOrganizationId(credentials)
      const organization = await inpostRequest<InpostOrganization>(
        credentials,
        `/v1/organizations/${orgId}`,
      )

      return {
        status: 'healthy',
        message: `Connected to InPost organization ${organization.id}`,
        details: {
          organizationId: organization.id,
          organizationName: organization.name ?? null,
        },
        checkedAt: new Date(),
      }
    } catch (err: unknown) {
      const message = match(err)
        .when((e): e is Error => e instanceof Error, (e) => e.message)
        .otherwise(() => 'Unknown error')
      return {
        status: 'unhealthy',
        message: `InPost connection failed: ${message}`,
        details: { error: message },
        checkedAt: new Date(),
      }
    }
  },
}
