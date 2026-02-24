import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { FilterQuery } from '@mikro-orm/postgresql'
import { findAndCountWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { InboxProposal, InboxEmail, InboxProposalAction, InboxDiscrepancy } from '../../data/entities'
import { proposalListQuerySchema } from '../../data/validators'
import { resolveRequestContext, UnauthorizedError } from '../routeHelpers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['inbox_ops.proposals.view'] },
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const query = proposalListQuerySchema.parse({
      status: url.searchParams.get('status') || undefined,
      search: url.searchParams.get('search') || undefined,
      page: url.searchParams.get('page') || undefined,
      pageSize: url.searchParams.get('pageSize') || undefined,
    })

    const ctx = await resolveRequestContext(req)

    const where: FilterQuery<InboxProposal> = {
      organizationId: ctx.organizationId,
      tenantId: ctx.tenantId,
      deletedAt: null,
      isActive: true,
    }

    if (query.status) {
      where.status = query.status
    }
    if (query.search) {
      where.summary = { $ilike: `%${escapeLikePattern(query.search)}%` }
    }

    const offset = (query.page - 1) * query.pageSize

    const [items, total] = await findAndCountWithDecryption(
      ctx.em,
      InboxProposal,
      where,
      {
        limit: query.pageSize,
        offset,
        orderBy: { createdAt: 'DESC' },
      },
      ctx.scope,
    )

    // Enrich proposals with email, action, and discrepancy data
    const proposalIds = items.map((p) => p.id)
    const emailIds = [...new Set(items.map((p) => p.inboxEmailId).filter(Boolean))]

    const [emails, allActions, allDiscrepancies] = await Promise.all([
      emailIds.length > 0
        ? findWithDecryption(ctx.em, InboxEmail, { id: { $in: emailIds }, organizationId: ctx.organizationId, tenantId: ctx.tenantId }, {}, ctx.scope)
        : Promise.resolve([] as InboxEmail[]),
      proposalIds.length > 0
        ? findWithDecryption(ctx.em, InboxProposalAction, { proposalId: { $in: proposalIds }, organizationId: ctx.organizationId, tenantId: ctx.tenantId, deletedAt: null }, {}, ctx.scope)
        : Promise.resolve([] as InboxProposalAction[]),
      proposalIds.length > 0
        ? findWithDecryption(ctx.em, InboxDiscrepancy, { proposalId: { $in: proposalIds }, organizationId: ctx.organizationId, tenantId: ctx.tenantId, resolved: false }, {}, ctx.scope)
        : Promise.resolve([] as InboxDiscrepancy[]),
    ])

    const emailMap = new Map(emails.map((e) => [e.id, e]))

    const enrichedItems = items.map((proposal) => {
      const email = emailMap.get(proposal.inboxEmailId)
      const proposalActions = allActions.filter((a) => a.proposalId === proposal.id)
      const proposalDiscrepancies = allDiscrepancies.filter((d) => d.proposalId === proposal.id)

      return {
        ...proposal,
        actionCount: proposalActions.length,
        pendingActionCount: proposalActions.filter((a) => a.status === 'pending').length,
        discrepancyCount: proposalDiscrepancies.length,
        emailSubject: email?.subject || null,
        emailFrom: email?.forwardedByName || email?.forwardedByAddress || null,
        receivedAt: email?.receivedAt || proposal.createdAt,
      }
    })

    return NextResponse.json({
      items: enrichedItems,
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    })
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[inbox_ops:proposals] Error listing proposals:', err)
    return NextResponse.json({ error: 'Failed to list proposals' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'InboxOps',
  summary: 'Proposals',
  methods: {
    GET: {
      summary: 'List proposals',
      description: 'List inbox proposals with optional status filter and pagination',
      responses: [
        { status: 200, description: 'Paginated list of proposals' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
  },
}
