import { z } from 'zod'
import { MAX_CUSTOM_FIELD_KEYS_PER_RECORD } from '@open-mercato/shared/modules/entities/validation'

const scalarValue = z.union([z.string().max(10_000), z.number(), z.boolean()])

export const addressCustomValuesSchema = z.record(
  z.string().regex(/^[a-z][a-z0-9_]*$/i).max(128),
  z.union([scalarValue, z.array(scalarValue).max(128), z.null()]),
).refine((values) => (
  Object.keys(values).length <= MAX_CUSTOM_FIELD_KEYS_PER_RECORD && JSON.stringify(values).length <= 65_536
))
