/** Bounded JSON decoding for maintenance: numeric tokens must not pass through IEEE-754. */
export function parseRotationJson(text: string, numeric?: (source: string) => unknown): unknown {
  const unsupported = () => new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
  if (Buffer.byteLength(text) > 1024 * 1024) throw unsupported()
  let depth = 0; let nodes = 0
  for (let offset = 0; offset < text.length; offset++) {
    const token = text[offset]
    if (token === '"') {
      for (;;) {
        const end = text.indexOf('"', offset + 1)
        if (end < 0) throw new SyntaxError('Invalid JSON string')
        let escaped = 0
        for (let previous = end - 1; text[previous] === '\\'; previous--) escaped++
        offset = end
        if (escaped % 2 === 0) break
      }
    } else if (token === '[' || token === '{') {
      if (++depth > 64 || ++nodes > 10000) throw unsupported()
    } else if (token === ']' || token === '}') {
      if (--depth < 0) throw new SyntaxError('Invalid JSON structure')
    } else if ((token === ',' || token === ':') && ++nodes > 10000) throw unsupported()
  }
  const raw = (JSON as unknown as { rawJSON?: (source: string) => unknown }).rawJSON
  return JSON.parse(text, (_key: string, value: unknown, context?: { source?: string }) => {
    if (typeof value !== 'number') return value
    if (!context?.source || (!numeric && !raw)) throw unsupported()
    return numeric ? numeric(context.source) : raw!(context.source)
  })
}

/** Match the existing encrypted-field JSON heuristic, preserving ordinary text. */
export function parseRotationFieldValue(text: string, numeric?: (source: string) => unknown): unknown {
  if (text[0] !== '{' && text[0] !== '[') return text
  try { return parseRotationJson(text, numeric) }
  catch (error) { if (error instanceof SyntaxError) return text; throw error }
}
