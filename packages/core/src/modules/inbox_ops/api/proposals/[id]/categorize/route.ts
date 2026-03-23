import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runWithCacheTenant } from '@open-mercato/cache'
import { categorizeProposalSchema } from '../../../../data/validators'
import { resolveCache, invalidateCountsCache } from '../../../../lib/cache'
import {
  resolveRequestContext,
  resolveProposal,
  handleRouteError,
  isErrorResponse,
} from '../../../routeHelpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['inbox_ops.proposals.manage'] },
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveRequestContext(req)
    const proposal = await resolveProposal(new URL(req.url), ctx)
    if (isErrorResponse(proposal)) return proposal

    const body = await req.json()
    const parsed = categorizeProposalSchema.safeParse(body)
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      return NextResponse.json({ error: `Invalid category: ${issues}` }, { status: 400 })
    }

    const previousCategory = proposal.category || null
    proposal.category = parsed.data.category
    await ctx.em.flush()

    const cache = resolveCache(ctx.container)
    await runWithCacheTenant(ctx.tenantId, () => invalidateCountsCache(cache, ctx.tenantId))

    return NextResponse.json({
      ok: true,
      category: parsed.data.category,
      previousCategory,
    })
  } catch (err) {
    return handleRouteError(err, 'categorize proposal')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'InboxOps',
  summary: 'Categorize proposal',
  methods: {
    POST: {
      summary: 'Set or change the category of a proposal',
      description: 'Assigns a category to a proposal. Returns the new and previous category for undo support.',
      responses: [
        { status: 200, description: 'Category updated' },
        { status: 400, description: 'Invalid category value' },
        { status: 404, description: 'Proposal not found' },
      ],
    },
  },
}
