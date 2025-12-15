import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { resolveDictionariesRouteContext } from '@open-mercato/core/modules/dictionaries/api/context'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const paramsSchema = z.object({ key: z.string() })

export async function GET(req: Request, ctx: { params?: { key?: string } }) {
    try {
        const context = await resolveDictionariesRouteContext(req)
        const { key } = paramsSchema.parse({ key: ctx.params?.key })
        const url = new URL(req.url)
        const search = url.searchParams.get('search') || ''
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500)

        // Find dictionary by key
        const dictionaryFilter: any = {
            key,
            tenantId: context.tenantId,
            deletedAt: null,
        }

        if (context.readableOrganizationIds.length) {
            dictionaryFilter.organizationId = { $in: context.readableOrganizationIds }
        }

        const dictionary = await context.em.findOne(Dictionary, dictionaryFilter)

        if (!dictionary) {
            throw new CrudHttpError(404, {
                error: context.translate('dictionaries.errors.not_found', 'Dictionary not found')
            })
        }

        // Find entries
        const entryFilter: any = {
            dictionary,
            organizationId: dictionary.organizationId,
            tenantId: dictionary.tenantId,
        }

        if (search) {
            entryFilter.$or = [
                { value: { $ilike: `%${search}%` } },
                { label: { $ilike: `%${search}%` } },
            ]
        }

        const entries = await context.em.find(
            DictionaryEntry,
            entryFilter,
            { orderBy: { label: 'asc' }, limit }
        )

        return NextResponse.json({
            items: entries.map((entry) => ({
                id: entry.id,
                value: entry.value,
                label: entry.label,
                color: entry.color,
                icon: entry.icon,
            })),
        })
    } catch (err) {
        if (err instanceof CrudHttpError) {
            return NextResponse.json(err.body, { status: err.status })
        }
        console.error('[dictionaries.by-code.entries.GET] Unexpected error', err)
        return NextResponse.json({ error: 'Failed to load dictionary entries' }, { status: 500 })
    }
}