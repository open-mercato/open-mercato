import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { InboxProposalAction } from '../../../../data/entities'
import type { ProposalTranslationEntry } from '../../../../data/entities'
import { translateProposalSchema } from '../../../../data/validators'
import { translateProposalContent } from '../../../../lib/translationProvider'
import {
  resolveRequestContext,
  resolveProposal,
  handleRouteError,
  isErrorResponse,
} from '../../../routeHelpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['inbox_ops.proposals.view'] },
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveRequestContext(req)
    const proposal = await resolveProposal(new URL(req.url), ctx)
    if (isErrorResponse(proposal)) return proposal

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const parsed = translateProposalSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 })
    }

    const { targetLocale } = parsed.data
    const proposalLanguage = proposal.workingLanguage || 'en'

    if (proposalLanguage === targetLocale) {
      return NextResponse.json({ error: 'Proposal is already in the requested language' }, { status: 400 })
    }

    // Return cached translation if available
    const cached = proposal.translations?.[targetLocale]
    if (cached) {
      return NextResponse.json({ translation: cached, cached: true })
    }

    // Load actions for translation
    const actions = await findWithDecryption(
      ctx.em,
      InboxProposalAction,
      { proposalId: proposal.id, organizationId: ctx.organizationId, tenantId: ctx.tenantId, deletedAt: null },
      { orderBy: { sortOrder: 'ASC' } },
      ctx.scope,
    )

    const actionDescriptions: Record<string, string> = {}
    for (const action of actions) {
      actionDescriptions[action.id] = action.description
    }

    const result = await translateProposalContent({
      summary: proposal.summary,
      actionDescriptions,
      sourceLanguage: proposalLanguage,
      targetLocale,
    })

    const entry: ProposalTranslationEntry = {
      summary: result.summary,
      actions: result.actions,
      translatedAt: new Date().toISOString(),
    }

    // Cache the translation on the proposal entity
    const translations = proposal.translations || {}
    translations[targetLocale] = entry
    proposal.translations = translations
    await ctx.em.flush()

    return NextResponse.json({ translation: entry, cached: false })
  } catch (err) {
    return handleRouteError(err, 'translate proposal')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'InboxOps',
  summary: 'Translate proposal',
  methods: {
    POST: {
      summary: 'Translate proposal content',
      description: 'Translates the proposal summary and action descriptions to the target locale. Results are cached.',
      responses: [
        { status: 200, description: 'Translation result' },
        { status: 400, description: 'Invalid target locale or same language' },
        { status: 404, description: 'Proposal not found' },
      ],
    },
  },
}
