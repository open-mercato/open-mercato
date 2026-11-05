/**
 * @jest-environment node
 */

import { readCustomerFieldsSectionError } from '../modules/checkout/lib/customerFieldErrors'

describe('LinkTemplateForm customer field section errors', () => {
  it('hides the section-level message when nested customer-field errors exist', () => {
    expect(
      readCustomerFieldsSectionError({
        customerFieldsSchema: 'Use camelCase starting with a letter.',
        'customerFieldsSchema.0.key': 'Use camelCase starting with a letter.',
      }),
    ).toBeUndefined()
  })

  it('keeps direct section-level errors when no nested field errors exist', () => {
    expect(
      readCustomerFieldsSectionError({
        customerFieldsSchema: 'At least one customer field is required.',
      }),
    ).toBe('At least one customer field is required.')
  })
})
