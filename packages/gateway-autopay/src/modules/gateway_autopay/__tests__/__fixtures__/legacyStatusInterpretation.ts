import type { AutopayStatusInterpretation } from '../../lib/status-map'

export const legacyStatusInterpretation: AutopayStatusInterpretation = {
  status: 'captured',
  amount: 10,
  amountReceived: 10,
  currencyCode: 'PLN',
}
