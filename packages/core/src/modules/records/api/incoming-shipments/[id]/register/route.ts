import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { RecordsIncomingShipment } from '../../../../data/entities'

const paramsSchema = z.object({ id: z.string().uuid() })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['records.incoming_shipments.register'] },
}

export async function POST(request: Request, args: { params: Promise<Record<string, string | string[]>> }) {
  const paramsRaw = await args.params
  const parsed = paramsSchema.safeParse({ id: paramsRaw.id })
  if (!parsed.success) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const auth = await getAuthFromRequest(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const tenantId = auth.tenantId
  const organizationId = scope?.selectedId ?? auth.orgId
  if (!tenantId || !organizationId) {
    return NextResponse.json({ error: 'Missing tenant or organization context' }, { status: 400 })
  }

  const shipment = await em.findOne(RecordsIncomingShipment, {
    id: parsed.data.id,
    tenantId,
    organizationId,
    deletedAt: null,
  })
  if (!shipment) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (shipment.status === 'registered' || shipment.rpwNumber) {
    return NextResponse.json(
      { error: 'Incoming shipment is already registered' },
      { status: 409 },
    )
  }

  const result = await em.transactional(async (tx) => {
    const locked = await tx.findOne(
      RecordsIncomingShipment,
      {
        id: parsed.data.id,
        tenantId,
        organizationId,
        deletedAt: null,
      },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    )
    if (!locked) return { kind: 'not_found' as const }
    if (locked.status === 'registered' || locked.rpwNumber) return { kind: 'already_registered' as const }

    if (!locked.receivedAt) {
      return { kind: 'invalid' as const, error: 'receivedAt is required to register an incoming shipment' }
    }
    const symbol = (locked.receivingOrgUnitSymbol || '').trim()
    if (!symbol) {
      return { kind: 'invalid' as const, error: 'receivingOrgUnitSymbol is required to register an incoming shipment' }
    }

    const now = new Date()
    const year = locked.receivedAt.getFullYear() || now.getFullYear()
    const rows = await tx.getConnection().execute<{ current_value: string }[]>(
      `
        insert into records_rpw_sequences (id, organization_id, tenant_id, receiving_org_unit_id, year, current_value, created_at, updated_at)
        values (gen_random_uuid(), ?, ?, ?, ?, ?, now(), now())
        on conflict (organization_id, tenant_id, receiving_org_unit_id, year)
        do update set current_value = records_rpw_sequences.current_value + 1, updated_at = now()
        returning current_value
      `,
      [organizationId, tenantId, locked.receivingOrgUnitId, year, 1],
    )
    const seq = Math.max(1, Number(rows?.[0]?.current_value ?? 1))
    const padded = String(seq).padStart(5, '0')
    const rpwNumber = `RPW/${symbol}/${padded}/${year}`

    locked.rpwSequence = seq
    locked.rpwNumber = rpwNumber
    locked.status = 'registered'
    locked.updatedAt = new Date()
    await tx.flush()

    return { kind: 'ok' as const, id: String(locked.id), rpwNumber, sequence: seq, year }
  })

  if (result.kind === 'not_found') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (result.kind === 'already_registered') return NextResponse.json({ error: 'Incoming shipment is already registered' }, { status: 409 })
  if (result.kind === 'invalid') return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({ ok: true, ...result }, { status: 200 })
}

export const openApi = {
  methods: {
    POST: {
      summary: 'Register incoming shipment (assign RPW)',
      description: 'Assigns the RPW number and marks the shipment as registered.',
      tags: ['Records'],
      params: paramsSchema,
      responses: [
        {
          status: 200,
          description: 'Registered',
          schema: z.object({
            ok: z.literal(true),
            kind: z.literal('ok'),
            id: z.string().uuid(),
            rpwNumber: z.string(),
            sequence: z.number(),
            year: z.number(),
          }),
        },
        {
          status: 400,
          description: 'Validation error',
          schema: z.object({ error: z.string() }),
        },
        {
          status: 401,
          description: 'Unauthorized',
          schema: z.object({ error: z.string() }),
        },
        {
          status: 404,
          description: 'Not found',
          schema: z.object({ error: z.string() }),
        },
        {
          status: 409,
          description: 'Already registered',
          schema: z.object({ error: z.string() }),
        },
      ],
    },
  },
}
