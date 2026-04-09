export function isIgnorableDerivedKeyWarningLine(line) {
  if (typeof line !== 'string') return false

  return line.startsWith('⚠️ [encryption][kms] Vault read error')
    || line.startsWith('⚠️ [encryption][kms] No tenant DEK found in Vault')
    || line.startsWith("path: 'secret/data/tenant_key_")
    || line.startsWith("error: 'fetch failed'")
    || line === '}'
    || line.startsWith('━━━━━━━━')
    || line.includes('Using derived tenant encryption keys')
    || line.startsWith('Source: TENANT_DATA_ENCRYPTION_FALLBACK_KEY')
    || line.startsWith('Secret: ')
    || line.startsWith('Persist this secret securely.')
}

export function isIgnorableSearchWarningLine(line) {
  if (typeof line !== 'string') return false

  const normalized = line.trim()

  return /^\[SearchService\] Strategy \S+ failed\b/.test(normalized)
    || /^\[search\.[^\]]+\] Failed to\b/.test(normalized)
}

export function shouldIgnoreSplashPassthroughLine(line, options = {}) {
  if (typeof line !== 'string') return false
  void options
  return isIgnorableSearchWarningLine(line)
}
