import { RULE_FIELD_SPECS } from '../ruleFieldSpecs'

describe('RULE_FIELD_SPECS net-amount labelling', () => {
  it('labels the row_total value as net and explains the basis', () => {
    const valueSpec = RULE_FIELD_SPECS.row_total.find((spec) => spec.key === 'value')
    expect(valueSpec).toMatchObject({
      labelKey: 'promotions.fields.rowTotalValue',
      labelFallback: 'Value (net)',
      hintKey: 'promotions.fields.netAmountHint',
    })
  })

  it('keeps order_value on its own tax-inclusive switch instead of the net hint', () => {
    const valueSpec = RULE_FIELD_SPECS.order_value.find((spec) => spec.key === 'value')
    expect(valueSpec?.hintKey).toBeUndefined()
    expect(RULE_FIELD_SPECS.order_value.some((spec) => spec.key === 'taxInclusive')).toBe(true)
  })
})
