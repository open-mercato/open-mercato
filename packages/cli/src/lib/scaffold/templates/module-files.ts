/**
 * Module backbone templates (data/validators.ts, components/statusMap.ts,
 * acl.ts, setup.ts, index.ts). acl/setup/index are generated only when absent —
 * the UI slice must reference real feature IDs.
 */

export const validatorsTemplate = `import { z } from 'zod'

// Optimistic locking is ON by default for CrudForm edit flows: the {{entityLower}}
// API responses MUST return \`updatedAt\` and the backing table MUST carry an
// \`updated_at\` column so \`initialValues.updatedAt\` can drive the
// x-om-ext-optimistic-lock-expected-updated-at header on update and delete.
export const {{entityCamel}}CreateSchema = z.object({
{{zodFields}}
})

export const {{entityCamel}}UpdateSchema = {{entityCamel}}CreateSchema.extend({
  id: z.string().uuid(),
  updatedAt: z.string().optional(),
})

export type {{entityPascal}}CreateInput = z.infer<typeof {{entityCamel}}CreateSchema>
export type {{entityPascal}}UpdateInput = z.infer<typeof {{entityCamel}}UpdateSchema>
`

export const statusMapTemplate = `import type { StatusMap } from '@open-mercato/ui/primitives/status-badge'

export type {{entityPascal}}Status = {{statusUnion}}

// Shared status → semantic-variant mapping (DS rule: status colors come from
// StatusBadge variants, never hardcoded palette classes).
export const {{entityCamel}}StatusMap: StatusMap<{{entityPascal}}Status> = {
{{statusMapEntries}}
}
`

export const aclTemplate = `export const features = [
  { id: '{{featuresPrefix}}.view', title: 'View {{moduleTitleLower}}', module: '{{moduleId}}' },
  {
    id: '{{featuresPrefix}}.create',
    title: 'Create {{moduleTitleLower}}',
    module: '{{moduleId}}',
    dependsOn: ['{{featuresPrefix}}.view'],
  },
  {
    id: '{{featuresPrefix}}.edit',
    title: 'Edit {{moduleTitleLower}}',
    module: '{{moduleId}}',
    dependsOn: ['{{featuresPrefix}}.view'],
  },
  {
    id: '{{featuresPrefix}}.delete',
    title: 'Delete {{moduleTitleLower}}',
    module: '{{moduleId}}',
    dependsOn: ['{{featuresPrefix}}.view'],
  },
]

export default features
`

export const setupTemplate = `import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['{{featuresPrefix}}.*'],
    admin: ['{{featuresPrefix}}.*'],
    employee: ['{{featuresPrefix}}.view'],
  },
}

export default setup
`

export const moduleIndexTemplate = `import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: '{{moduleId}}',
  title: '{{moduleTitle}}',
  version: '0.1.0',
  description: '{{moduleTitle}} module scaffolded with mercato module scaffold.',
  author: 'Open Mercato Team',
  license: 'MIT',
}

export { features } from './acl'
`
