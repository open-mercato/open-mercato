import { getAuthFromRequest } from "@/lib/auth/server"
import { createRequestContainer } from "@/lib/di/container"
import { NextResponse } from "next/server"
import { resolveFeatureCheckContext } from "@open-mercato/core/modules/directory/utils/organizationScope"
import { FeatureTogglesService } from "../../../lib/feature-flag-check"
import { featureTogglesTag, checkResponseSchema, featureToggleErrorSchema } from "../../openapi"
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'

export async function GET(req: Request) {
    const auth = await getAuthFromRequest(req)
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const identifier = url.searchParams.get('identifier')

    if (!identifier) {
        return NextResponse.json({ error: 'Missing required parameter: identifier' }, { status: 400 })
    }

    if (auth.isSuperAdmin === true) {
        return NextResponse.json({
            ok: true,
            value: true,
            resolution: {
                valueType: "boolean",
                value: true,
                source: "override",
                toggleId: "superadmin",
                identifier,
                tenantId: "superadmin"
            }
        })
    }

    const container = await createRequestContainer()
    const { scope } = await resolveFeatureCheckContext({
        container,
        auth,
        request: req
    })

    if (!scope.tenantId) {
        return NextResponse.json({ error: 'Tenant context required. Please select a tenant.' }, { status: 400 })
    }

    const featureTogglesService = container.resolve('featureTogglesService') as FeatureTogglesService
    const result = await featureTogglesService.getBoolConfig(identifier, scope.tenantId)

    if (!result.ok) {
        return NextResponse.json(result, { status: result.error.code === "MISSING_TOGGLE" ? 404 : 400 })
    }

    return NextResponse.json(result)
}

const routeMetadata = {
    GET: { requireAuth: true },
}

export const metadata = routeMetadata

export const openApi: OpenApiRouteDoc = {
    tag: featureTogglesTag,
    summary: 'Check feature toggle status',
    methods: {
        GET: {
            summary: 'Check if feature is enabled',
            description: 'Checks if a feature toggle is enabled for the current context.',
            query: z.object({
                identifier: z.string().describe('Feature toggle identifier'),
            }),
            responses: [
                { status: 200, description: 'Feature status', schema: checkResponseSchema },
            ],
            errors: [
                { status: 400, description: 'Bad Request', schema: featureToggleErrorSchema },
                { status: 401, description: 'Unauthorized', schema: featureToggleErrorSchema },
                { status: 404, description: 'Tenant not found', schema: featureToggleErrorSchema },
            ],
        },
    },
}
