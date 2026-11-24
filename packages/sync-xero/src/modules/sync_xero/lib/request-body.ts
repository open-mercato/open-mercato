import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'

const MALFORMED_BODY = Symbol('malformed_body')

/**
 * The body of a POST whose fields are all optional: an empty body reads as `{}`, malformed JSON as
 * a value no object schema accepts, and any other JSON as itself (so `null` still fails the schema).
 */
export async function readOptionalJsonBody(req: Request): Promise<unknown> {
  const raw = await req.text()
  if (raw.trim() === '') return {}
  return readJsonSafe<unknown>(raw, MALFORMED_BODY)
}
