import type { CustomEntitySpec } from '@open-mercato/shared/modules/entities'
import { E } from '@open-mercato/core/generated/entities.ids.generated'

const systemEntities: CustomEntitySpec[] = [
  {
    id: E.booking.booking_team_member,
    label: 'Team Member',
    description: 'Booking team members who can be scheduled on services.',
    labelField: 'displayName',
    showInSidebar: false,
    fields: [
      {
        key: 'hourly_rate',
        kind: 'float',
        label: 'Hourly rate',
        description: 'Billing rate per hour.',
        filterable: true,
        formEditable: true,
        listVisible: true,
      },
      {
        key: 'currency_code',
        kind: 'text',
        label: 'Currency code',
        description: 'ISO 4217 currency code for rates.',
        filterable: true,
        formEditable: true,
        listVisible: true,
      },
      {
        key: 'years_of_experience',
        kind: 'integer',
        label: 'Years of experience',
        description: 'Total years of experience for the team member.',
        filterable: true,
        formEditable: true,
        listVisible: true,
      },
      {
        key: 'bio',
        kind: 'multiline',
        label: 'Bio',
        description: 'Short profile or notes about the team member.',
        formEditable: true,
        listVisible: false,
        editor: 'simpleMarkdown',
      },
    ],
  },
]

export const entities = systemEntities
export default systemEntities
