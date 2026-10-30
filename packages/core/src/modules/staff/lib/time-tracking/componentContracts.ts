import { z } from 'zod'

/**
 * Shared building blocks for the `propsSchema` every replaceable time-tracking
 * component publishes (EP-31).
 *
 * The schema is the contract a replacement must satisfy: `useRegisteredComponent`
 * parses the resolved props against it in development and falls back to the
 * original component when they do not match, so a schema that accepts anything
 * would let a broken replacement render instead of being caught. Scalars are
 * therefore described exactly; callbacks and React nodes, which zod cannot
 * describe structurally, are narrowed to the one runtime check that matters.
 */

export const callbackProp = <TCallback>() =>
  z.custom<TCallback>((value) => typeof value === 'function', {
    message: '[internal] expected a function prop',
  })

export const optionalCallbackProp = <TCallback>() =>
  z.custom<TCallback | undefined>(
    (value) => value === undefined || typeof value === 'function',
    { message: '[internal] expected a function prop or undefined' },
  )

export const opaqueProp = <TValue>() => z.custom<TValue>(() => true)
