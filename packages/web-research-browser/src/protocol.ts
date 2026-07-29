export type SidecarErrorKind = 'init' | 'needs-install' | 'navigation' | 'runtime' | 'timeout' | 'unknown'

export type SidecarRequest = {
  readonly id: string
  readonly method: string
  readonly params?: Record<string, unknown>
}

export type SidecarReply =
  | { readonly id: string; readonly ok: true; readonly result?: unknown }
  | {
      readonly id: string
      readonly ok: false
      readonly error: { readonly message: string; readonly kind: SidecarErrorKind }
    }

export class SidecarError extends Error {
  readonly kind: SidecarErrorKind

  constructor(message: string, kind: SidecarErrorKind = 'runtime') {
    super(message)
    this.name = 'SidecarError'
    this.kind = kind
  }
}

/**
 * Line-delimited JSON, one object per line, correlated by `id`. Deliberately not
 * JSON-RPC 2.0: the surface is four methods over a pipe we own both ends of, and
 * an `ok` discriminant is easier to narrow than presence-of-`error`.
 */
export function encodeLine(value: SidecarRequest | SidecarReply): string {
  return `${JSON.stringify(value)}\n`
}

export function decodeLine(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

export function isReply(value: unknown): value is SidecarReply {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { id?: unknown }).id === 'string' &&
    typeof (value as { ok?: unknown }).ok === 'boolean'
  )
}
