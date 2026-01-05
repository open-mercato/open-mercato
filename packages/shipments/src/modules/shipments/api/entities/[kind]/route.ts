import { NextResponse } from 'next/server'
import { z } from 'zod'

import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'

import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { User } from '@open-mercato/core/modules/auth/data/entities'

const paramsSchema = z.object({ kind: z.string() })

export async function GET(req: Request, ctx: { params?: { kind?: string } }) {
    const auth = await getAuthFromRequest(req)
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { kind } = paramsSchema.parse({ kind: ctx.params?.kind })

    const url = new URL(req.url)
    const search = url.searchParams.get('search') || ''
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500)

    const container = await createRequestContainer()
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const em = container.resolve('em') as EntityManager

    const filter: any = {
        deletedAt: null,
    }

    if (auth.tenantId) {
        filter.tenantId = auth.tenantId
    }

    if (scope?.filterIds?.length) {
        filter.organizationId = { $in: scope.filterIds }
    }

    if (search) {
        filter.$or = [
            { displayName: { $ilike: `%${search}%` } },
            { primaryEmail: { $ilike: `%${search}%` } },
        ]
    }

    if (kind === 'user') {
        const people = await em.find(
            User,
            filter,
            { orderBy: { name: 'asc' }, limit }
        )

        return NextResponse.json({
            items: people.map((person) => ({
                id: person.id,
                name: person.name,
                email: person.email,
            })),
        })
    }

    const customers = await em.find(
        CustomerEntity,
        { ...filter, kind },
        { orderBy: { displayName: 'asc' }, limit }
    )

    return NextResponse.json({
        items: customers.map((company) => ({
            id: company.id,
            displayName: company.displayName,
            primaryEmail: company.primaryEmail,
            status: company.status,
        })),
    })
}