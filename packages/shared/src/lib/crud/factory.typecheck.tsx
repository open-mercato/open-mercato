import type { CrudCommandActionConfig, CrudCtx } from './factory'

function callWithLegacyResponseArguments(
  response: NonNullable<CrudCommandActionConfig['response']>,
  ctx: CrudCtx,
) {
  return response({ result: { ok: true }, logEntry: null, ctx })
}

void callWithLegacyResponseArguments
