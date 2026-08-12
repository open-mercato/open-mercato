/**
 * Provider callback payload → the agent's declared OUTCOME envelope.
 *
 * This is the one part of the connector that has NO provider knowledge at all:
 * the platform must be handed `{ kind: 'researcher', data: { answer } }`, and
 * where the answer sits inside the provider's own JSON is a per-tenant credential
 * (`resultPath`, e.g. `result.answer` or `data.0.output.text`).
 *
 * FAILING IS A FIRST-CLASS OUTCOME HERE. A `normalize` that throws is classified
 * by the callback route as a connector failure: the run settles `failed` and the
 * workflow wakes down its `error` handle immediately, rather than parking until
 * the deadline sweep. That is the right answer for a path that does not match —
 * redelivering the same bytes cannot help — so every refusal below is deliberate
 * and none of them guesses.
 *
 * NOTHING FROM THE PAYLOAD IS EVER INTERPOLATED INTO A REFUSAL. The message names
 * the configured path and the JSON TYPE found there; the value itself is
 * third-party content that gets persisted on the run and rendered in the cockpit.
 */

import { readJsonPath, describeJsonType } from './jsonPath'
import type { GenericHttpCallResult } from '../data/validators'

export class GenericHttpNormalizeError extends Error {
  readonly code = 'AGENT_HTTP_NORMALIZE_FAILED'
  constructor(message: string) {
    super(`[internal] ${message}`)
    this.name = 'GenericHttpNormalizeError'
  }
}

/**
 * Extract the answer and wrap it in the researcher envelope.
 *
 * Scalars are accepted and stringified — a provider answering `true` or `42` at
 * the configured path has answered, and refusing it would push the operator into
 * writing a wrapper service for no reason. Structured values are NOT: an object
 * has no single reading, `JSON.stringify` of it would reach a downstream agent's
 * prompt as text that looks like data, and the honest instruction is "point
 * resultPath at the field you mean".
 */
export function normalizeGenericHttpCallback(
  rawPayload: unknown,
  resultPath: string,
): GenericHttpCallResult {
  const found = readJsonPath(rawPayload, resultPath)

  if (found === undefined || found === null) {
    throw new GenericHttpNormalizeError(
      `the callback payload carries nothing at the configured result path "${resultPath}"`,
    )
  }
  if (typeof found === 'object') {
    throw new GenericHttpNormalizeError(
      `the callback payload carries ${describeJsonType(found)} at the configured result path "${resultPath}"; point it at a scalar field`,
    )
  }

  const answer = typeof found === 'string' ? found : String(found)
  if (!answer.trim().length) {
    // An empty answer is not an answer. Completing the run would hand a
    // downstream agent an empty string as though a question had been answered;
    // failing sends the workflow down its `error` handle, where the author
    // decided what to do when the provider has nothing to say.
    throw new GenericHttpNormalizeError(
      `the callback payload carries an empty value at the configured result path "${resultPath}"`,
    )
  }

  return { kind: 'researcher', data: { answer } }
}
