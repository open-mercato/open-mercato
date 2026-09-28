import { z } from 'zod'

/**
 * A boolean that arrives in a query string.
 *
 * `z.coerce.boolean()` looks like the obvious tool and is a trap: it coerces with `Boolean(value)`, so
 * the string `'false'` — which is truthy — becomes `true`. `?isActive=false` then filters *for* active
 * rows, and because the request succeeds nothing anywhere reports it.
 *
 * This schema accepts the tokens a client actually sends (`'true'`, `'false'`, `'1'`, `'0'`) plus a
 * real boolean for in-process callers, and rejects anything else loudly instead of guessing.
 */
export function booleanQueryParam() {
  return z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .transform((value) => value === true || value === 'true' || value === '1')
    .optional()
}
