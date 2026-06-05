import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createFixedTemplateInput, createLinkFixture, readLink } from './helpers/fixtures'

/**
 * TC-CHKT-039: OSS optimistic locking now guards the pay-link/template DELETE.
 *
 * QA round-6 (PR #2055): after a save conflict surfaced the unified conflict
 * bar, clicking Delete still removed the stale record. The pay-link/template
 * delete path was unguarded — the client sent no version header and the
 * `checkout.link.delete` / `checkout.template.delete` commands never called
 * `enforceCommandOptimisticLock` (only the *.update commands did).
 *
 * This spec proves the server contract the UI relies on:
 *   - GET detail exposes `updatedAt`.
 *   - DELETE without the header succeeds (strictly additive).
 *   - DELETE with a stale header returns 409 with the structured conflict body.
 *   - DELETE with a fresh header deletes the record.
 *
 * Requires `OM_OPTIMISTIC_LOCK=all` (CI default).
 */
const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

function readUpdatedAt(record: Record<string, unknown>): string {
  const raw = record.updatedAt ?? record.updated_at
  expect(typeof raw, 'link detail should expose updatedAt as a string').toBe('string')
  return new Date(Date.parse(raw as string)).toISOString()
}

test.describe('TC-CHKT-039: pay-link stale DELETE optimistic-lock guard', () => {
  test('stale DELETE returns 409; fresh DELETE succeeds; header-less stays backward-compatible', async ({ request }) => {
    const token = await getAuthToken(request)

    // Two links: one to prove the stale→409→fresh path, one to prove the
    // strictly-additive header-less delete still works.
    const guarded = await createLinkFixture(request, token, createFixedTemplateInput())
    const additive = await createLinkFixture(request, token, createFixedTemplateInput())
    let guardedDeleted = false
    let additiveDeleted = false

    try {
      const detail = await readLink(request, token, guarded.id)
      const t0 = readUpdatedAt(detail as Record<string, unknown>)

      // A save advances the version, making t0 stale.
      const bump = await request.fetch(`/api/checkout/links/${encodeURIComponent(guarded.id)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { subtitle: 'bumped for stale-delete test' },
      })
      expect(bump.status(), 'PUT bump should succeed').toBeLessThan(300)

      // Stale DELETE → 409 with the structured conflict body; record survives.
      const staleDelete = await request.fetch(`/api/checkout/links/${encodeURIComponent(guarded.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, [OPTIMISTIC_LOCK_HEADER]: t0 },
      })
      expect(staleDelete.status(), 'DELETE with a stale header should return 409').toBe(409)
      expect((await staleDelete.json()) as Record<string, unknown>).toMatchObject({
        code: 'optimistic_lock_conflict',
        expectedUpdatedAt: t0,
      })

      const stillThere = await readLink(request, token, guarded.id)
      const t1 = readUpdatedAt(stillThere as Record<string, unknown>)
      expect(t1, 'stale delete must NOT have removed the record').not.toBe(t0)

      // Fresh DELETE → succeeds.
      const freshDelete = await request.fetch(`/api/checkout/links/${encodeURIComponent(guarded.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, [OPTIMISTIC_LOCK_HEADER]: t1 },
      })
      expect(freshDelete.status(), 'DELETE with a fresh header should succeed').toBeLessThan(300)
      guardedDeleted = true

      // Header-less DELETE still works (strictly additive).
      const nohdrDelete = await request.fetch(`/api/checkout/links/${encodeURIComponent(additive.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(nohdrDelete.status(), 'DELETE without a header should succeed').toBeLessThan(300)
      additiveDeleted = true
    } finally {
      if (!guardedDeleted) {
        await request.fetch(`/api/checkout/links/${encodeURIComponent(guarded.id)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => undefined)
      }
      if (!additiveDeleted) {
        await request.fetch(`/api/checkout/links/${encodeURIComponent(additive.id)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => undefined)
      }
    }
  })
})
