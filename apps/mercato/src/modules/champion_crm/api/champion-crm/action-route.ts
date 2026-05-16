import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { resolveActorId, resolveChampionCrmRequestContext } from '../../lib/request-context'

export type ChampionCrmActionRouteContext = {
  params: Promise<{ id: string }>
}

export async function runChampionCrmActionRoute<TInput, TResult>(
  req: Request,
  resourceId: string,
  schema: z.ZodType<TInput>,
  operation: string,
  handler: (input: TInput, context: {
    em: EntityManager
    tenantId: string
    organizationId: string
    actorUserId: string | null
  }) => Promise<TResult>,
) {
  try {
    const ctx = await resolveChampionCrmRequestContext(req)
    const tenantId = String(ctx.auth.tenantId)
    const organizationId = String(ctx.selectedOrganizationId)
    const actorUserId = resolveActorId(ctx.auth)
    const guardUserId = actorUserId ?? 'system'
    const raw = await readJsonSafe<Record<string, unknown>>(req, {})
    const input = schema.parse(raw ?? {})

    const guardResult = await validateCrudMutationGuard(ctx.container, {
      tenantId,
      organizationId,
      userId: guardUserId,
      resourceKind: 'champion_crm.demo_flow',
      resourceId,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: { __operation: operation, ...(input && typeof input === 'object' ? input as Record<string, unknown> : {}) },
    })
    if (guardResult?.ok === false) return NextResponse.json(guardResult.body, { status: guardResult.status })

    const em = ctx.container.resolve('em') as EntityManager
    const result = await handler(input, { em, tenantId, organizationId, actorUserId })

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(ctx.container, {
        tenantId,
        organizationId,
        userId: guardUserId,
        resourceKind: 'champion_crm.demo_flow',
        resourceId,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    if (error instanceof CrudHttpError) return NextResponse.json(error.body, { status: error.status })
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Validation failed', details: error.issues }, { status: 400 })
    if (error instanceof Error && /not found/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 404 })
    if (error instanceof Error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
