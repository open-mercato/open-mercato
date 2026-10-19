/**
 * Adapter contract version. Adapter packages declare the version they were built
 * against; the loader refuses to instantiate a mismatched major rather than let a
 * stale adapter fail in an unpredictable place at request time.
 */
export const CONTRACT_VERSION = 1

/**
 * Oldest adapter contract this engine still accepts.
 *
 * An exact-match check makes every bump a flag day: a purely additive change
 * would disable every third-party adapter at once, with nothing wrong with any
 * of them. A range lets an additive bump raise `CONTRACT_VERSION` while leaving
 * this behind, and a genuinely breaking one raise both together.
 */
export const MIN_SUPPORTED_CONTRACT_VERSION = 1

export function isSupportedContractVersion(version: unknown): version is number {
  return (
    typeof version === 'number' &&
    Number.isInteger(version) &&
    version >= MIN_SUPPORTED_CONTRACT_VERSION &&
    version <= CONTRACT_VERSION
  )
}
