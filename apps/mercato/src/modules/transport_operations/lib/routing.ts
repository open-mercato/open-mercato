export type GeoPoint = { latitude: number; longitude: number }

export type RouteEstimate = {
  distanceKm: number
  durationMinutes: number
  provider: string
}

const EARTH_RADIUS_KM = 6371.0088
const DEFAULT_AVERAGE_SPEED_KPH = 65
const ROAD_FACTOR = 1.25

function toRadians(value: number): number {
  return (value * Math.PI) / 180
}

/** Great-circle distance in kilometres. */
export function haversineDistanceKm(origin: GeoPoint, destination: GeoPoint): number {
  const deltaLat = toRadians(destination.latitude - origin.latitude)
  const deltaLon = toRadians(destination.longitude - origin.longitude)
  const lat1 = toRadians(origin.latitude)
  const lat2 = toRadians(destination.latitude)
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * A local fallback estimate. The great-circle distance is multiplied by a road
 * factor because a straight line is never the driven route; the duration uses a
 * configurable average speed. It is deliberately labelled `local` so a caller can
 * tell it apart from a routing-provider answer.
 */
export function estimateRouteLocally(
  origin: GeoPoint,
  destination: GeoPoint,
  averageSpeedKph = DEFAULT_AVERAGE_SPEED_KPH,
): RouteEstimate {
  const distanceKm = haversineDistanceKm(origin, destination) * ROAD_FACTOR
  const speed = averageSpeedKph > 0 ? averageSpeedKph : DEFAULT_AVERAGE_SPEED_KPH
  const durationMinutes = Math.max(1, Math.round((distanceKm / speed) * 60))
  return {
    distanceKm: Math.round(distanceKm * 10) / 10,
    durationMinutes,
    provider: 'local',
  }
}

export type RouteEstimateProvider = {
  id: string
  estimate(origin: GeoPoint, destination: GeoPoint): Promise<RouteEstimate>
}

type FetchLike = typeof fetch

/**
 * OSRM-compatible provider, enabled only when `OM_ROUTING_OSRM_URL` is set.
 * Any transport/provider failure falls back to the local estimate so a map or
 * ETA request never blocks on an external service.
 */
export function createOsrmRoutingProvider(
  baseUrl: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 4000,
): RouteEstimateProvider {
  const trimmed = baseUrl.replace(/\/+$/, '')
  return {
    id: 'osrm',
    async estimate(origin, destination) {
      const coordinates = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetchImpl(`${trimmed}/route/v1/driving/${coordinates}?overview=false`, {
          signal: controller.signal,
        })
        if (!response.ok) return estimateRouteLocally(origin, destination)
        const payload = await response.json() as {
          routes?: Array<{ distance?: number; duration?: number }>
        }
        const route = payload.routes?.[0]
        if (!route || !Number.isFinite(route.distance) || !Number.isFinite(route.duration)) {
          return estimateRouteLocally(origin, destination)
        }
        return {
          distanceKm: Math.round(((route.distance as number) / 1000) * 10) / 10,
          durationMinutes: Math.max(1, Math.round((route.duration as number) / 60)),
          provider: 'osrm',
        }
      } catch {
        return estimateRouteLocally(origin, destination)
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}

export function resolveRoutingProvider(env: Record<string, string | undefined> = process.env): RouteEstimateProvider {
  const osrmUrl = env.OM_ROUTING_OSRM_URL?.trim()
  if (osrmUrl) return createOsrmRoutingProvider(osrmUrl)
  return {
    id: 'local',
    async estimate(origin, destination) {
      return estimateRouteLocally(origin, destination)
    },
  }
}
