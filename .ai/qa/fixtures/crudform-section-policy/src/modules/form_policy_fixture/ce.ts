import type { CustomEntitySpec } from '@open-mercato/shared/modules/entities'

export const entities: CustomEntitySpec[] = [{
  id: 'form_policy_fixture:record',
  label: 'CrudForm policy fixture record',
  showInSidebar: false,
  fields: [{ key: 'region', kind: 'text', label: 'Region', formEditable: true }],
}]

export default entities
