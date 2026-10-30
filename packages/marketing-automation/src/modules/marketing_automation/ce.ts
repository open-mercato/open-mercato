import { cf } from '@open-mercato/shared/modules/dsl'

/**
 * Custom fields this module adds to somebody else's entity.
 *
 * **Why a custom field rather than a column.** A birth date is the one piece of data a birthday campaign cannot
 * do without, and the platform stores none: not on `customer_entities`, not on the person profile. Adding a
 * column would be an edit to the customers module for a marketing need — while custom fields are the platform's
 * own sanctioned way for one module to extend another's record. The cost is that the value lives in
 * `custom_field_values` rather than in a typed column, which the birthday sweep source accounts for.
 */
export const entities = [
  {
    id: 'customers:customer_person_profile',
    fields: [
      cf.date('marketing_birth_date', {
        label: 'Birth date',
        description: 'Used by birthday campaigns. Only the month and day are matched, so a year nobody knows can be left approximate.',
      }),
    ],
  },
]

export default entities
