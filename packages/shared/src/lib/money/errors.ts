import type { Currency } from './types'

function describeCurrency(currency: Currency): string {
  return `${currency.code}(${currency.decimalPlaces})`
}

export class CurrencyMismatchError extends Error {
  readonly left: Currency
  readonly right: Currency

  constructor(left: Currency, right: Currency, message?: string) {
    super(message ?? `[internal] Currency mismatch: ${describeCurrency(left)} vs ${describeCurrency(right)}`)
    this.name = 'CurrencyMismatchError'
    this.left = left
    this.right = right
  }
}

export class CurrencyNotResolvedError extends Error {
  readonly code: string

  constructor(code: string, cause?: unknown) {
    super(`[internal] Currency could not be resolved: ${code.slice(0, 20)}`, cause === undefined ? undefined : { cause })
    this.name = 'CurrencyNotResolvedError'
    this.code = code
  }
}

export class InvalidAllocationError extends Error {
  constructor(reason: string) {
    super(`[internal] Invalid money allocation: ${reason}`)
    this.name = 'InvalidAllocationError'
  }
}

export class InvalidMoneyRoundingError extends Error {
  constructor(reason: string) {
    super(`[internal] Invalid money rounding: ${reason}`)
    this.name = 'InvalidMoneyRoundingError'
  }
}

/** `resolveMoney` received input that `moneyInputSchema` rejects; `cause` is the `ZodError`. */
export class InvalidMoneyInputError extends Error {
  constructor(cause?: unknown) {
    super('[internal] Invalid money input', cause === undefined ? undefined : { cause })
    this.name = 'InvalidMoneyInputError'
  }
}

/** `restoreMoney` / `moneyFromColumns` received a snapshot `moneySnapshotSchema` rejects; `cause` is the `ZodError`. */
export class InvalidMoneySnapshotError extends Error {
  constructor(cause?: unknown) {
    super('[internal] Invalid money snapshot', cause === undefined ? undefined : { cause })
    this.name = 'InvalidMoneySnapshotError'
  }
}
