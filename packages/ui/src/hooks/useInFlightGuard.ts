'use client'

import * as React from 'react'

export type InFlightGuardOptions = {
  onDuplicate?: () => void
}

export type InFlightGuard = {
  isPending: boolean
  run: <T>(operation: () => Promise<T> | T) => Promise<T | undefined>
  guard: <TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => Promise<TResult> | TResult,
  ) => (...args: TArgs) => Promise<TResult | undefined>
}

/**
 * Prevents an async handler from running concurrently with itself.
 *
 * Why: React state updates (`setPending(true)`) are asynchronous, so a disabled
 * button does not help between the first click and the next render — rapid clicks,
 * keyboard-driven submits, and assistive tech can still trigger duplicate work.
 * A synchronous ref flips on the first call and rejects subsequent calls until
 * the operation resolves, guaranteeing single-flight execution regardless of UI.
 */
export function useInFlightGuard(options: InFlightGuardOptions = {}): InFlightGuard {
  const { onDuplicate } = options
  const runningRef = React.useRef(false)
  const [isPending, setIsPending] = React.useState(false)
  const onDuplicateRef = React.useRef(onDuplicate)
  React.useEffect(() => {
    onDuplicateRef.current = onDuplicate
  }, [onDuplicate])

  const run = React.useCallback(async function run<T>(operation: () => Promise<T> | T): Promise<T | undefined> {
    if (runningRef.current) {
      onDuplicateRef.current?.()
      return undefined
    }
    runningRef.current = true
    setIsPending(true)
    try {
      return await operation()
    } finally {
      runningRef.current = false
      setIsPending(false)
    }
  }, [])

  const guard = React.useCallback(function guard<TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => Promise<TResult> | TResult,
  ) {
    return async (...args: TArgs): Promise<TResult | undefined> => run(() => fn(...args))
  }, [run])

  return { isPending, run, guard }
}
