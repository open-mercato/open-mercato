"use client"

type ScopedHeaderStackOptions = {
  normalize?: boolean
}

function normalizeHeaderMap(input: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    const trimmedKey = key.trim()
    if (!trimmedKey) continue
    const trimmedValue = typeof value === 'string' ? value.trim() : ''
    if (!trimmedValue) continue
    normalized[trimmedKey] = trimmedValue
  }
  return normalized
}

export function createScopedHeaderStack(options?: ScopedHeaderStackOptions) {
  const stack: Array<Record<string, string>> = []
  const normalize = options?.normalize !== false

  function resolveScopedHeaders(): Record<string, string> {
    if (!stack.length) return {}
    const merged: Record<string, string> = {}
    for (const item of stack) {
      Object.assign(merged, item)
    }
    return merged
  }

  async function withScopedHeaders<T>(headers: Record<string, string>, run: () => Promise<T>): Promise<T> {
    const normalized = normalize ? normalizeHeaderMap(headers) : headers
    stack.push(normalized)
    try {
      return await run()
    } finally {
      const index = stack.lastIndexOf(normalized)
      if (index >= 0) {
        stack.splice(index, 1)
      }
    }
  }

  return {
    withScopedHeaders,
    resolveScopedHeaders,
  }
}
