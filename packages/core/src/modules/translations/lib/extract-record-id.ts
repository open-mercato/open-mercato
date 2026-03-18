const UUID_LIKE_PATTERN = /^[0-9a-f-]{20,}$/i

type Params = Record<string, string | string[]>

function readParam(params: Params, key: string) {
  const value = params[key]

  if (!value) {
    return undefined
  }

  if (Array.isArray(value)) {
    return value.find((entry) => typeof entry === 'string' && entry.length > 0)
  }

  return value
}

export function extractRecordId(params: Params) {
  const directRecordId = readParam(params, 'recordId')
  if (directRecordId) {
    return directRecordId
  }

  const directId = readParam(params, 'id')
  if (directId) {
    return directId
  }

  const orderedIdCandidates = Object.entries(params)
    .filter(
      ([key]) =>
        key !== 'recordId' && key !== 'id' && key.toLowerCase().endsWith('id'),
    )
    .reverse()

  for (const [, value] of orderedIdCandidates) {
    const segments = Array.isArray(value) ? value : [value]
    for (const seg of segments) {
      if (seg && UUID_LIKE_PATTERN.test(seg)) {
        return seg
      }
    }
  }

  for (const [, value] of Object.entries(params)) {
    const segments = Array.isArray(value) ? value : [value]
    for (const seg of segments) {
      if (seg && UUID_LIKE_PATTERN.test(seg)) return seg
    }
  }

  return undefined
}
