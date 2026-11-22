/** @jest-environment node */
import {
  createOsrmRoutingProvider,
  estimateRouteLocally,
  haversineDistanceKm,
} from '../routing'

const RIYADH = { latitude: 24.7136, longitude: 46.6753 }
const DAMMAM = { latitude: 26.4207, longitude: 50.0888 }

describe('routing estimates', () => {
  it('computes a plausible great-circle distance', () => {
    const distance = haversineDistanceKm(RIYADH, DAMMAM)
    expect(distance).toBeGreaterThan(350)
    expect(distance).toBeLessThan(430)
  })

  it('returns a local road-distance and duration estimate', () => {
    const estimate = estimateRouteLocally(RIYADH, DAMMAM, 80)
    expect(estimate.provider).toBe('local')
    expect(estimate.distanceKm).toBeGreaterThan(haversineDistanceKm(RIYADH, DAMMAM))
    expect(estimate.durationMinutes).toBeGreaterThan(0)
  })

  it('falls back to the local estimate when the OSRM provider fails', async () => {
    const provider = createOsrmRoutingProvider('https://routing.invalid', (async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch)
    const estimate = await provider.estimate(RIYADH, DAMMAM)
    expect(estimate.provider).toBe('local')
  })

  it('uses the OSRM route when the provider responds', async () => {
    const provider = createOsrmRoutingProvider('https://routing.local', (async () => new Response(JSON.stringify({
      routes: [{ distance: 420000, duration: 18000 }],
    }), { status: 200 })) as unknown as typeof fetch)
    const estimate = await provider.estimate(RIYADH, DAMMAM)
    expect(estimate).toEqual({ distanceKm: 420, durationMinutes: 300, provider: 'osrm' })
  })
})
