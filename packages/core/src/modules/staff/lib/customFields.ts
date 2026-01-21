import type { CustomFieldDefinition } from '@open-mercato/shared/modules/entities'
import type { FieldSetInput } from '@open-mercato/core/modules/entities/lib/field-definitions'
import { defineFields, cf } from '@open-mercato/shared/modules/dsl'
import { E } from '#generated/entities.ids.generated'

export const STAFF_TEAM_MEMBER_FIELDSET_HR = 'staff_member_hr'
export const STAFF_TEAM_MEMBER_FIELDSET_PROFILE = 'staff_member_profile'
export const STAFF_TEAM_MEMBER_FIELDSET_PREFERENCES = 'staff_member_preferences'

export const STAFF_TEAM_MEMBER_FIELDSETS = [
  {
    code: STAFF_TEAM_MEMBER_FIELDSET_HR,
    label: 'HR details',
    description: 'Compensation, employment, and onboarding details.',
    groups: [
      { code: 'compensation', title: 'Compensation' },
      { code: 'employment', title: 'Employment' },
      { code: 'status', title: 'Status' },
    ],
  },
  {
    code: STAFF_TEAM_MEMBER_FIELDSET_PROFILE,
    label: 'Profile',
    description: 'Bio and experience overview.',
    groups: [
      { code: 'experience', title: 'Experience' },
      { code: 'bio', title: 'Bio' },
    ],
  },
  {
    code: STAFF_TEAM_MEMBER_FIELDSET_PREFERENCES,
    label: 'Work preferences',
    description: 'Work style and schedule notes.',
    groups: [
      { code: 'schedule', title: 'Schedule' },
      { code: 'work', title: 'Work style' },
    ],
  },
] as const

export const STAFF_TEAM_MEMBER_CUSTOM_FIELDS: CustomFieldDefinition[] = [
  cf.float('hourly_rate', {
    label: 'Hourly rate',
    description: 'Billing rate per hour.',
    filterable: true,
    formEditable: true,
    listVisible: true,
    fieldset: STAFF_TEAM_MEMBER_FIELDSET_HR,
    group: { code: 'compensation', title: 'Compensation' },
  }),
  cf.select('currency_code', [], {
    label: 'Currency',
    description: 'Currency for the hourly rate.',
    filterable: true,
    formEditable: true,
    listVisible: true,
    fieldset: STAFF_TEAM_MEMBER_FIELDSET_HR,
    group: { code: 'compensation' },
    optionsUrl: '/api/currencies/options',
  }),
  cf.text('employment_date', {
    label: 'Employment date',
    description: 'YYYY-MM-DD',
    filterable: true,
    formEditable: true,
    listVisible: true,
    fieldset: STAFF_TEAM_MEMBER_FIELDSET_HR,
    group: { code: 'employment', title: 'Employment' },
  }),
  cf.select('employment_type', ['full_time', 'part_time', 'contract', 'intern'], {
    label: 'Employment type',
    filterable: true,
    formEditable: true,
    listVisible: true,
    fieldset: STAFF_TEAM_MEMBER_FIELDSET_HR,
    group: { code: 'employment' },
  }),
  cf.boolean('onboarded', {
    label: 'Onboarded',
    description: 'Whether onboarding is complete.',
    filterable: true,
    formEditable: true,
    listVisible: true,
    fieldset: STAFF_TEAM_MEMBER_FIELDSET_HR,
    group: { code: 'status', title: 'Status' },
  }),
  cf.integer('years_of_experience', {
    label: 'Years of experience',
    description: 'Total years of experience for the team member.',
    filterable: true,
    formEditable: true,
    listVisible: true,
    fieldset: STAFF_TEAM_MEMBER_FIELDSET_PROFILE,
    group: { code: 'experience', title: 'Experience' },
  }),
  cf.multiline('bio', {
    label: 'Bio',
    description: 'Short profile or notes about the team member.',
    formEditable: true,
    listVisible: false,
    editor: 'simpleMarkdown',
    fieldset: STAFF_TEAM_MEMBER_FIELDSET_PROFILE,
    group: { code: 'bio', title: 'Bio' },
  }),
  cf.text('focus_areas', {
    label: 'Focus areas',
    description: 'Key specialties or focus areas.',
    formEditable: true,
    listVisible: false,
    multi: true,
    fieldset: STAFF_TEAM_MEMBER_FIELDSET_PREFERENCES,
    group: { code: 'work', title: 'Work style' },
  }),
  cf.select('work_mode', ['onsite', 'hybrid', 'remote'], {
    label: 'Work mode',
    formEditable: true,
    listVisible: true,
    fieldset: STAFF_TEAM_MEMBER_FIELDSET_PREFERENCES,
    group: { code: 'schedule', title: 'Schedule' },
  }),
]

export const STAFF_TEAM_MEMBER_CUSTOM_FIELD_SETS: FieldSetInput[] = [
  defineFields(E.staff.staff_team_member, STAFF_TEAM_MEMBER_CUSTOM_FIELDS, 'staff'),
]
