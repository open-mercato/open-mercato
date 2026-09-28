import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { PALETTE_PATH } from './helpers/marketing'

type Palette = {
  triggers?: Array<{ eventId?: string; labelKey?: string; available?: boolean; blockedReasonKey?: string | null }>
  steps?: Array<{ type?: string; labelKey?: string; channel?: string | null; uiFields?: Array<{ name?: string; kind?: string }> }>
}

/**
 * TC-MA-003: the palette is derived from the live registries.
 *
 * This is what makes a step type contributed by another module appear with a working inspector
 * form and server-side validation without shipping UI, so the contract that matters is that every
 * entry carries its label key and its field metadata — not the specific list of built-ins.
 */
test.describe('TC-MA-003 palette', () => {
  test('describes the built-in steps with the metadata the inspector needs', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'GET', PALETTE_PATH, { token })
    expect(response.ok()).toBe(true)

    const palette = await readJsonSafe<Palette>(response)
    const steps = palette?.steps ?? []
    const byType = new Map(steps.map((step) => [step.type, step]))

    for (const type of ['wait', 'add_tag', 'send_email']) {
      const step = byType.get(type)
      expect(step, `${type} is offered`).toBeTruthy()
      expect(step?.labelKey, `${type} carries a translation key`).toBeTruthy()
      expect(Array.isArray(step?.uiFields), `${type} declares its editable fields`).toBe(true)
    }

    // Only a step that actually messages somebody declares a channel; that is what subjects it to
    // the frequency cap and quiet hours.
    expect(byType.get('send_email')?.channel).toBe('email')
    expect(byType.get('add_tag')?.channel ?? null).toBeNull()
    expect(byType.get('wait')?.channel ?? null).toBeNull()

    // Every field kind must be one the inspector can render.
    const renderable = new Set(['text', 'textarea', 'number', 'select', 'customer_tag'])
    for (const step of steps) {
      for (const field of step.uiFields ?? []) {
        expect(renderable.has(String(field.kind)), `${step.type}.${field.name} has a renderable kind`).toBe(true)
        expect(field.name).toBeTruthy()
      }
    }
  })

  test('marks unavailable triggers with a reason instead of hiding them', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'GET', PALETTE_PATH, { token })
    const palette = await readJsonSafe<Palette>(response)
    const triggers = palette?.triggers ?? []

    const available = triggers.filter((trigger) => trigger.available).map((trigger) => trigger.eventId)
    expect(available).toContain('sales.order.created')
    expect(available).toContain('customers.person.created')

    // Abandoned cart cannot be implemented without cart sessions. It stays listed, disabled and
    // explained, rather than silently missing.
    const cart = triggers.find((trigger) => trigger.eventId === 'storefront.cart.abandoned')
    expect(cart, 'abandoned cart is listed').toBeTruthy()
    expect(cart?.available).toBe(false)
    expect(cart?.blockedReasonKey, 'and says why it is unavailable').toBeTruthy()
  })
})
