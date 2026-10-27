/**
 * @internal Marks an error instance with a `Symbol.for` brand, so `instanceof` recognises it
 * across duplicated module copies in one process (separate bundle layers load separate copies
 * of a class). The brand keys are frozen once released.
 */
export function brandError(target: object, brand: symbol): void {
  Object.defineProperty(target, brand, { value: true, enumerable: false })
}

/** @internal True when `value` carries `brand`, whichever module copy created it. */
export function hasErrorBrand(value: unknown, brand: symbol): boolean {
  return typeof value === 'object' && value !== null && Reflect.get(value, brand) === true
}
