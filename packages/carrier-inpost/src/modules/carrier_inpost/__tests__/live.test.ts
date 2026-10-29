/**
 * TEMPORARY live integration test — calls the real InPost sandbox API via our adapter.
 * Run with:
 *   yarn workspace @open-mercato/carrier-inpost test --no-coverage --testPathPatterns=live
 *
 * Do NOT delete until explicitly told to.
 *
 * Credentials are read from environment variables — set before running:
 *   INPOST_SANDBOX_TOKEN=<your-token>
 *   INPOST_SANDBOX_ORG_ID=<your-org-id>
 */

import { inpostAdapterV1 } from '../lib/adapters/v1'
import type { CreateShipmentInput } from '@open-mercato/core/modules/shipping_carriers/lib/adapter'

const CREDENTIALS: Record<string, unknown> = {
  apiToken: process.env.INPOST_SANDBOX_TOKEN ?? '',
  organizationId: process.env.INPOST_SANDBOX_ORG_ID ?? '',
  apiBaseUrl: 'https://sandbox-api-shipx-pl.easypack24.net',
  targetPoint: 'KRA010',
  senderCompanyName: 'Test Sender',
  senderEmail: 'sender@test.pl',
  senderPhone: '600100200',
  receiverEmail: 'jan.kowalski@test.pl',
  receiverPhone: '600200300',
}

const SHIPMENT_INPUT: CreateShipmentInput = {
  credentials: CREDENTIALS,
  orderId: `live-test-${Date.now()}`,
  serviceCode: 'locker_standard',
  origin: {
    line1: 'Ul. Testowa',
    line2: '1',
    city: 'Krakow',
    postalCode: '30-001',
    countryCode: 'PL',
  },
  destination: {
    line1: 'Ul. Odbiorcza',
    line2: '2',
    city: 'Warszawa',
    postalCode: '00-001',
    countryCode: 'PL',
  },
  packages: [{ weightKg: 1.0, lengthCm: 38, widthCm: 64, heightCm: 8 }],
}

xdescribe('[LIVE] inpostAdapterV1 — sandbox API', () => {
  jest.setTimeout(60_000)

  let createdShipmentId: string | undefined

  it('createShipment — full flow with HTTP call log', async () => {
    const originalFetch = global.fetch
    const calls: Array<{ url: string; method: string; status: number; body: unknown }> = []
    global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      const res = await originalFetch(input, init)
      const clone = res.clone()
      let body: unknown
      try { body = await clone.json() } catch { body = '<binary or text>' }
      calls.push({ url, method, status: res.status, body })
      if (init?.body) {
        console.log(`  → Request body: ${init.body}`)
      }
      return res
    }

    try {
      const result = await inpostAdapterV1.createShipment(SHIPMENT_INPUT)
      console.log('\n=== FINAL RESULT ===')
      console.log(JSON.stringify(result, null, 2))
      console.log(`\n=== ${calls.length} HTTP CALLS ===`)
      for (const [i, c] of calls.entries()) {
        console.log(`\n--- Call ${i + 1}: ${c.method} ${c.url} → ${c.status} ---`)
        console.log(JSON.stringify(c.body, null, 2))
      }

      // Poll the shipment status 3 times after the flow completes to observe async progression
      const shipmentId = result.shipmentId
      createdShipmentId = shipmentId
      console.log('\n=== POLLING shipment status after buy (3× with 1s delay) ===')
      for (let poll = 1; poll <= 3; poll++) {
        await new Promise((r) => setTimeout(r, 1000))
        const pollRes = await originalFetch(
          `https://sandbox-api-shipx-pl.easypack24.net/v1/shipments/${shipmentId}`,
          { headers: { Authorization: `Bearer ${CREDENTIALS.apiToken}`, Accept: 'application/json' } },
        )
        const pollBody = await pollRes.json()
        console.log(`\n--- Poll ${poll}/3 → status: ${pollBody.status}, tracking_number: ${pollBody.tracking_number}, transactions: ${JSON.stringify(pollBody.transactions)} ---`)
      }

      expect(typeof result.shipmentId).toBe('string')
      expect(typeof result.trackingNumber).toBe('string')
    } finally {
      global.fetch = originalFetch
    }
  })

  it('cancelShipment — DELETE the shipment created above', async () => {
    if (!createdShipmentId) {
      console.warn('No shipmentId from createShipment test — skipping cancel')
      return
    }

    console.log(`\n=== CANCEL shipmentId: ${createdShipmentId} ===`)
    let result: { status: string } | undefined
    let errorMessage: string | undefined

    try {
      result = await inpostAdapterV1.cancelShipment({
        credentials: CREDENTIALS,
        shipmentId: createdShipmentId,
      })
      console.log('Cancel result:', JSON.stringify(result, null, 2))
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err)
      console.log('Cancel threw (expected if already confirmed):', errorMessage)
    }

    // Verify via GET that the shipment is now cancelled (or confirm the error is invalid_action)
    const verifyRes = await fetch(
      `https://sandbox-api-shipx-pl.easypack24.net/v1/shipments/${createdShipmentId}`,
      { headers: { Authorization: `Bearer ${CREDENTIALS.apiToken}`, Accept: 'application/json' } },
    )
    const verifyBody = await verifyRes.json()
    console.log(`\nShipment status after cancel attempt: ${verifyBody.status}`)

    if (result) {
      expect(result.status).toBe('cancelled')
      expect(verifyBody.status).toBe('cancelled')
    } else {
      // Already confirmed — API returned invalid_action, which is correct behaviour
      expect(errorMessage).toContain('InPost API error')
    }
  })
})
