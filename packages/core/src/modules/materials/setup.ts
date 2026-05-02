import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: [
      'materials.*',
    ],
    employee: [
      'materials.material.view',
      'materials.material.manage',
      'materials.units.view',
      'materials.units.manage',
      'materials.supplier_link.view',
      'materials.supplier_link.manage',
      'materials.price.view',
      'materials.price.manage',
      'materials.widgets.linked-material',
      'materials.widgets.supplied-materials',
    ],
  },
}

export default setup
