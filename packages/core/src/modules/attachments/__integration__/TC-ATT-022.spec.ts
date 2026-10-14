import { expect, test } from '@playwright/test'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { ownerPolicyRequest, withAttachmentOwnerFixture } from '@open-mercato/core/helpers/integration/attachmentAccessFixtures'

export const integrationMeta = { dependsOnModules: ['documents'] }

test('TC-ATT-022: a waiting mutation authorizes the owner committed before its row lock is acquired', async ({ request }) => {
  if (!process.env.DATABASE_URL?.trim()) throw new Error('[internal] Managed integration DATABASE_URL is required')
  await withAttachmentOwnerFixture(request, async (fixture) => {
    await fixture.share(fixture.visible, 'editor')
    const file = await fixture.upload(fixture.visible, 'race', { tags: ['unchanged'] })
    await withClient(async client => {
      await client.query('begin')
      let pending: ReturnType<typeof ownerPolicyRequest> | undefined
      try {
        await client.query('select id from attachments where id = $1 for update', [file])
        pending = ownerPolicyRequest('PATCH', `/api/attachments/library/${file}`, fixture.recipient.token, { tags: ['must-not-commit'] })
        const deadline = Date.now() + 5000
        let blocked = false
        while (Date.now() < deadline) {
          const result = await client.query<{ blocked: boolean }>('select exists(select 1 from pg_stat_activity where datname = current_database() and pg_backend_pid() = any(pg_blocking_pids(pid))) as blocked')
          if (result.rows[0]?.blocked) { blocked = true; break }
          await new Promise(resolve => setTimeout(resolve, 25))
        }
        expect(blocked, 'the HTTP transaction must actually wait on the fixture row lock').toBe(true)
        await client.query('update attachments set record_id = $2 where id = $1', [file, fixture.hidden])
        await client.query('commit')
        expect((await pending).status).toBe(404)
        const result = await client.query<{ record_id: string; storage_metadata: { tags: string[] } }>('select record_id, storage_metadata from attachments where id = $1', [file])
        expect(result.rows[0].record_id).toBe(fixture.hidden)
        expect(result.rows[0].storage_metadata.tags).toEqual(['unchanged'])
      } finally {
        await client.query('rollback')
        await pending?.catch(() => undefined)
      }
    })
  })
})
