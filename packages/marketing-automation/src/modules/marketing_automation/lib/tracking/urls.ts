import { signTrackingToken } from './token.js'
import type { TrackingClaims } from './token.js'

export const TRACK_OPEN_PATH = '/api/marketing_automation/track/open'
export const TRACK_CLICK_PATH = '/api/marketing_automation/track/click'

/**
 * The token travels as a single query parameter on purpose.
 *
 * One parameter means the URL contains no `&`, so it survives an HTML attribute, a plain-text body
 * and the average mail client's link rewriting without escaping surprises.
 */
export const TRACKING_TOKEN_PARAM = 't'

function withToken(baseUrl: string, path: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}?${TRACKING_TOKEN_PARAM}=${token}`
}

export function openPixelUrl(baseUrl: string, claims: Omit<TrackingClaims, 'purpose' | 'target'>, secret: string): string {
  return withToken(baseUrl, TRACK_OPEN_PATH, signTrackingToken({ ...claims, purpose: 'open' }, secret))
}

export function clickUrl(
  baseUrl: string,
  claims: Omit<TrackingClaims, 'purpose' | 'target'>,
  secret: string,
  target: string,
): string {
  return withToken(baseUrl, TRACK_CLICK_PATH, signTrackingToken({ ...claims, purpose: 'click', target }, secret))
}
