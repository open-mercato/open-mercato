import { sanitizeDocumentsDisplayLabel } from './displayLabels'

export const COLLABORATION_COLOR_FALLBACK = '#64748b'

const COLLABORATION_COLOR_PATTERN = /^#[0-9a-f]{6}$/i
const UNSAFE_AWARENESS_NAME_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u
const MAX_AWARENESS_NAME_LENGTH = 120

function isEncryptedAwarenessName(value: string): boolean {
  const parts = value.split(':')
  return parts.length === 4 && parts[3] === 'v1'
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function channelToHex(value: number): string {
  return Math.round(value).toString(16).padStart(2, '0')
}

function hslToHex(hue: number, saturationPercent: number, lightnessPercent: number): string {
  const saturation = saturationPercent / 100
  const lightness = lightnessPercent / 100
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const intermediate = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
  const match = lightness - chroma / 2
  const [red, green, blue] =
    hue < 60 ? [chroma, intermediate, 0]
      : hue < 120 ? [intermediate, chroma, 0]
        : hue < 180 ? [0, chroma, intermediate]
          : hue < 240 ? [0, intermediate, chroma]
            : hue < 300 ? [intermediate, 0, chroma]
              : [chroma, 0, intermediate]
  return `#${channelToHex((red + match) * 255)}${channelToHex((green + match) * 255)}${channelToHex((blue + match) * 255)}`
}

/**
 * Awareness colors are interpolated into inline styles by TipTap. Accept only
 * the single canonical representation emitted by the server, never general
 * CSS color syntax.
 */
export function normalizeCollaborationColor(value: unknown): string {
  if (typeof value !== 'string' || !COLLABORATION_COLOR_PATTERN.test(value)) {
    return COLLABORATION_COLOR_FALLBACK
  }
  return value.toLowerCase()
}

export function resolveCollaborationUserColor(userId: string): string {
  return hslToHex(hashString(userId) % 360, 64, 42)
}

/**
 * Presence names come from an authenticated profile, but still cross the Yjs
 * awareness boundary. Reject control, directionality, zero-width and UUID
 * content and encryption envelopes so a collaborator cannot visually
 * impersonate another identity or leak internal data through a caret label.
 */
export function sanitizeCollaborationAwarenessName(value: unknown): string {
  const label = sanitizeDocumentsDisplayLabel(value)
  if (
    !label
    || label.length > MAX_AWARENESS_NAME_LENGTH
    || UNSAFE_AWARENESS_NAME_PATTERN.test(label)
    || isEncryptedAwarenessName(label)
  ) {
    return ''
  }
  return label
}

export function firstSafeCollaborationAwarenessName(...values: unknown[]): string {
  for (const value of values) {
    const label = sanitizeCollaborationAwarenessName(value)
    if (label) return label
  }
  return ''
}

export type CanonicalCollaborationAwarenessUser = {
  id: string
  name: string
  color: string
}

export function createCanonicalCollaborationAwarenessUser(
  userId: string,
  name: unknown,
): CanonicalCollaborationAwarenessUser {
  return {
    id: userId,
    name: sanitizeCollaborationAwarenessName(name),
    color: resolveCollaborationUserColor(userId),
  }
}
