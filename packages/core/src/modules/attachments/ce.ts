import type { CustomEntitySpec } from '@open-mercato/shared/modules/entities'
import { E } from '@open-mercato/generated/entity-ids'

const systemEntities: CustomEntitySpec[] = [
  {
    id: E.attachments.attachment,
    label: 'Attachment',
    description: 'Uploaded asset stored in the workspace attachment library.',
    labelField: 'fileName',
    showInSidebar: false,
    fields: [],
  },
]

export const entities = systemEntities
export default systemEntities
