import type {
  CommandInterceptor,
  CommandInterceptorContext,
  CommandInterceptorUndoContext,
} from './command-interceptor'

// ---------------------------------------------------------------------------
// Command pattern matching
// ---------------------------------------------------------------------------

export function matchesCommandPattern(pattern: string, commandId: string): boolean {
  if (pattern === '*') return true
  if (pattern === commandId) return true
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2)
    return commandId.startsWith(prefix + '.')
  }
  return false
}

// ---------------------------------------------------------------------------
// Collect matching interceptors
// ---------------------------------------------------------------------------

function collectMatching(
  interceptors: CommandInterceptor[],
  commandId: string,
  userFeatures: string[],
): CommandInterceptor[] {
  return interceptors
    .filter((i) => matchesCommandPattern(i.targetCommand, commandId))
    .filter((i) => !i.features?.length || i.features.every((f) => userFeatures.includes(f)))
    .sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50))
}

// ---------------------------------------------------------------------------
// Run beforeExecute interceptors
// ---------------------------------------------------------------------------

export async function runCommandInterceptorsBefore(
  interceptors: CommandInterceptor[],
  commandId: string,
  input: unknown,
  context: CommandInterceptorContext,
  userFeatures: string[],
): Promise<{
  ok: boolean
  error?: { message: string }
  modifiedInput?: Record<string, unknown>
  metadataByInterceptor: Map<string, Record<string, unknown>>
}> {
  const matching = collectMatching(interceptors, commandId, userFeatures)

  let currentInput = input
  const metadataByInterceptor = new Map<string, Record<string, unknown>>()

  for (const interceptor of matching) {
    if (!interceptor.beforeExecute) continue
    const result = await interceptor.beforeExecute(currentInput, { ...context, commandId })

    if (result?.ok === false) {
      return {
        ok: false,
        error: { message: result.message ?? `Blocked by command interceptor: ${interceptor.id}` },
        metadataByInterceptor,
      }
    }

    if (result?.modifiedInput) {
      currentInput =
        typeof currentInput === 'object' && currentInput
          ? { ...(currentInput as Record<string, unknown>), ...result.modifiedInput }
          : result.modifiedInput
    }

    if (result?.metadata) {
      metadataByInterceptor.set(interceptor.id, result.metadata)
    }
  }

  const inputChanged = currentInput !== input
  return {
    ok: true,
    modifiedInput: inputChanged ? (currentInput as Record<string, unknown>) : undefined,
    metadataByInterceptor,
  }
}

// ---------------------------------------------------------------------------
// Run afterExecute interceptors
// ---------------------------------------------------------------------------

export async function runCommandInterceptorsAfter(
  interceptors: CommandInterceptor[],
  commandId: string,
  input: unknown,
  result: unknown,
  context: CommandInterceptorContext,
  userFeatures: string[],
  metadataByInterceptor: Map<string, Record<string, unknown>>,
): Promise<{ modifiedResult?: Record<string, unknown> }> {
  const matching = collectMatching(interceptors, commandId, userFeatures)

  let currentResult = result

  for (const interceptor of matching) {
    if (!interceptor.afterExecute) continue
    try {
      const afterResult = await interceptor.afterExecute(
        input,
        currentResult,
        { ...context, commandId, metadata: metadataByInterceptor.get(interceptor.id) },
      )
      if (afterResult?.modifiedResult && typeof currentResult === 'object' && currentResult) {
        currentResult = { ...(currentResult as Record<string, unknown>), ...afterResult.modifiedResult }
      }
    } catch (error) {
      console.error(`[command-interceptor] afterExecute failed: ${interceptor.id}`, error)
    }
  }

  const resultChanged = currentResult !== result
  return { modifiedResult: resultChanged ? (currentResult as Record<string, unknown>) : undefined }
}

// ---------------------------------------------------------------------------
// Run beforeUndo interceptors
// ---------------------------------------------------------------------------

export async function runCommandInterceptorsBeforeUndo(
  interceptors: CommandInterceptor[],
  commandId: string,
  undoContext: CommandInterceptorUndoContext,
  context: CommandInterceptorContext,
  userFeatures: string[],
): Promise<{
  ok: boolean
  error?: { message: string }
  metadataByInterceptor: Map<string, Record<string, unknown>>
}> {
  const matching = collectMatching(interceptors, commandId, userFeatures)

  const metadataByInterceptor = new Map<string, Record<string, unknown>>()

  for (const interceptor of matching) {
    if (!interceptor.beforeUndo) continue
    const result = await interceptor.beforeUndo(undoContext, { ...context, commandId })

    if (result?.ok === false) {
      return {
        ok: false,
        error: { message: result.message ?? `Undo blocked by command interceptor: ${interceptor.id}` },
        metadataByInterceptor,
      }
    }

    if (result?.metadata) {
      metadataByInterceptor.set(interceptor.id, result.metadata)
    }
  }

  return { ok: true, metadataByInterceptor }
}

// ---------------------------------------------------------------------------
// Run afterUndo interceptors
// ---------------------------------------------------------------------------

export async function runCommandInterceptorsAfterUndo(
  interceptors: CommandInterceptor[],
  commandId: string,
  undoContext: CommandInterceptorUndoContext,
  context: CommandInterceptorContext,
  userFeatures: string[],
  metadataByInterceptor: Map<string, Record<string, unknown>>,
): Promise<void> {
  const matching = collectMatching(interceptors, commandId, userFeatures)

  for (const interceptor of matching) {
    if (!interceptor.afterUndo) continue
    try {
      await interceptor.afterUndo(
        undoContext,
        { ...context, commandId, metadata: metadataByInterceptor.get(interceptor.id) },
      )
    } catch (error) {
      console.error(`[command-interceptor] afterUndo failed: ${interceptor.id}`, error)
    }
  }
}
