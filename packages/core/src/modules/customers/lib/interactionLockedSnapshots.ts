const lockedBeforeSnapshots = new WeakMap<object, unknown>()

function isResultObject(value: unknown): value is object {
  return value !== null && typeof value === 'object'
}

export function recordLockedInteractionBefore<TResult extends object>(result: TResult, before: unknown): TResult {
  if (before !== null && before !== undefined) lockedBeforeSnapshots.set(result, before)
  return result
}

export function forwardLockedInteractionBefore<TResult extends object>(source: unknown, target: TResult): TResult {
  if (!isResultObject(source)) return target
  if (!lockedBeforeSnapshots.has(source)) return target
  lockedBeforeSnapshots.set(target, lockedBeforeSnapshots.get(source))
  return target
}

export function resolveLockedInteractionBefore(result: unknown, preparedBefore: unknown): unknown {
  if (isResultObject(result) && lockedBeforeSnapshots.has(result)) return lockedBeforeSnapshots.get(result)
  return preparedBefore
}
