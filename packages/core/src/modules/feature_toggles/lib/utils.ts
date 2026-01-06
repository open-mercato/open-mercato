import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

export async function buildContext(
    req: Request
): Promise<{
    ctx: CommandRuntimeContext
    auth: NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>>
    organizationId: string | null
    scope: { allowedIds: string[] | null }
}> {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth) throw new CrudHttpError(401, { error: 'Unauthorized' })

    const { organizationId, scope } = await resolveFeatureCheckContext({ container, auth, request: req })

    const ctx: CommandRuntimeContext = {
        container,
        auth,
        organizationScope: scope,
        selectedOrganizationId: organizationId ?? null,
        organizationIds: scope.allowedIds ?? (auth.orgId ? [auth.orgId] : null),
        request: req,
    }

    return { ctx, auth, organizationId: organizationId ?? null, scope }
}