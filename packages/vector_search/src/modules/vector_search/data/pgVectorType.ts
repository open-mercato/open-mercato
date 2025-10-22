import { Type, type Platform } from '@mikro-orm/core'

function decodeVector(value: unknown): number[] | null {
  if (value == null) return null
  if (Array.isArray(value)) return value.map((v) => Number(v))
  if (typeof value === 'string') {
    const trimmed = value.trim().replace(/^\[|\]$/g, '')
    if (!trimmed.length) return []
    return trimmed.split(',').map((part) => Number(part.trim()))
  }
  if (Buffer.isBuffer(value)) {
    const floats: number[] = []
    for (let i = 0; i + 4 <= value.length; i += 4) {
      floats.push(value.readFloatLE(i))
    }
    return floats
  }
  return null
}

export class PgVectorType extends Type<number[] | null, number[] | null> {
  override convertToDatabaseValue(value: number[] | null | undefined, _platform: Platform): number[] | null {
    if (value == null) return null
    return value
  }

  override convertToJSValue(value: unknown, _platform: Platform): number[] | null {
    return decodeVector(value)
  }

  override getColumnType(): string {
    return 'vector(1536)'
  }
}
