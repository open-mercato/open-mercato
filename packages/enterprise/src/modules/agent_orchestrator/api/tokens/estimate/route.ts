import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { countTokens, TOKEN_ENCODING } from '@open-mercato/shared/lib/ai/token-count'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agent_orchestrator.agents.view'] },
}

// Guard against pathological payloads. The tokenizer is O(n); a couple hundred KB
// of text is far more than any real definition file or pasted prompt.
const MAX_TEXT_LENGTH = 500_000

const requestSchema = z.object({ text: z.string().max(MAX_TEXT_LENGTH) })
const responseSchema = z.object({ tokens: z.number(), encoding: z.string() })
const errorSchema = z.object({ error: z.string() })

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    const tooLong = parsed.error.issues.some((issue) => issue.code === 'too_big')
    return NextResponse.json(
      { error: tooLong ? 'Text is too long to estimate' : 'Expected { text: string }' },
      { status: tooLong ? 413 : 400 },
    )
  }

  return NextResponse.json({ tokens: countTokens(parsed.data.text), encoding: TOKEN_ENCODING })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Estimate token count for text',
  methods: {
    POST: {
      summary: 'Count the o200k_base tokens of arbitrary text',
      description:
        'Returns the o200k_base token count of the supplied text using the same shared tokenizer that powers the per-file estimates on the Files tab. Gated by agent_orchestrator.agents.view.',
      requestBody: { schema: requestSchema },
      responses: [
        { status: 200, description: 'Token estimate', schema: responseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid body', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.agents.view', schema: errorSchema },
        { status: 413, description: 'Text too long', schema: errorSchema },
      ],
    },
  },
}
