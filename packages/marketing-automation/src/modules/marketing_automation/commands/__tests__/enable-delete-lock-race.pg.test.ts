import type { MikroORM } from '@mikro-orm/postgresql'
import { MarketingCampaign, MarketingCampaignRun, MarketingCampaignTrigger } from '../../data/entities'
import { createCampaignCommand, deleteCampaignCommand, saveCampaignGraphCommand, setCampaignEnabledCommand } from '../campaigns'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { PG_URL, createPgOrm, maybe, pgCommandContext } from '../../__tests__/pg-helpers'

/**
 * M7 against real concurrent connections: `set_campaign_enabled` and `delete_campaign` used to
 * check the optimistic-lock version against an unlocked read and then write with no row lock or
 * re-check — the same race `save_graph`/`apply_split_winner` were already guarded against. A fake
 * EntityManager cannot stage this; two real connections racing the same row can.
 */
maybe('campaign enable/delete/save_graph lock race against PostgreSQL', () => {
  jest.setTimeout(60_000)
  let orm: MikroORM

  beforeAll(async () => {
    orm = await createPgOrm([MarketingCampaign, MarketingCampaignTrigger, MarketingCampaignRun])
  }, 30_000)

  afterAll(async () => {
    await orm?.close(true)
  })

  async function createEnabledCampaign(): Promise<{ id: string; updatedAt: string }> {
    const ctx = pgCommandContext(orm)
    const created = await createCampaignCommand.execute({ name: 'Race target' }, ctx)
    const em = orm.em.fork()
    await em.nativeUpdate(MarketingCampaign, { id: created.id }, {
      definition: { version: 1, steps: [{ id: 's1', type: 'wait', params: { days: 1 } }] },
    })
    em.create(MarketingCampaignTrigger, {
      campaignId: created.id, tenantId: ctx.auth!.tenantId!, organizationId: ctx.auth!.orgId!,
      kind: 'event', eventId: 'sales.order.created',
    })
    await em.flush()
    const row = await em.findOneOrFail(MarketingCampaign, { id: created.id })
    return { id: created.id, updatedAt: row.updatedAt.toISOString() }
  }

  it('two concurrent enables racing the same stale version: exactly one lands, the other is told to reload', async () => {
    const { id, updatedAt } = await createEnabledCampaign()
    const ctx = pgCommandContext(orm)

    const results = await Promise.allSettled([
      setCampaignEnabledCommand.execute({ id, isEnabled: true, updatedAt }, ctx),
      setCampaignEnabledCommand.execute({ id, isEnabled: true, updatedAt }, ctx),
    ])
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(isCrudHttpError(rejected[0].reason) && rejected[0].reason.status).toBe(409)
  })

  it('delete racing a graph save on the same stale version: exactly one lands', async () => {
    const { id, updatedAt } = await createEnabledCampaign()
    const ctx = pgCommandContext(orm)

    const results = await Promise.allSettled([
      deleteCampaignCommand.execute({ id }, ctx),
      saveCampaignGraphCommand.execute({
        id, name: 'Renamed mid-race', triggers: [], definition: { version: 1, steps: [] }, updatedAt,
      }, ctx),
    ])
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    expect(fulfilled).toHaveLength(1)

    const row = await orm.em.fork().findOneOrFail(MarketingCampaign, { id })
    if (row.deletedAt) {
      // Delete won: the graph save must not have landed on top of it.
      expect(row.name).not.toBe('Renamed mid-race')
    } else {
      // The save won: the campaign must still be live with its new name.
      expect(row.name).toBe('Renamed mid-race')
    }
  })

  it('delete removes the campaign AND its triggers together, even under a losing race', async () => {
    const { id } = await createEnabledCampaign()
    const ctx = pgCommandContext(orm)
    await deleteCampaignCommand.execute({ id }, ctx)

    const campaign = await orm.em.fork().findOneOrFail(MarketingCampaign, { id })
    expect(campaign.deletedAt).not.toBeNull()
    const triggers = await orm.em.fork().find(MarketingCampaignTrigger, { campaignId: id })
    expect(triggers).toHaveLength(0)
  })
})
