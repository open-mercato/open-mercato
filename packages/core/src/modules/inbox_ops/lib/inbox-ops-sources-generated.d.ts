declare module '@/.mercato/generated/inbox-ops-sources.generated' {
  import type { InboxOpsSourceAdapter } from '@open-mercato/shared/modules/inbox-ops-sources'

  export const inboxOpsSourceConfigEntries: Array<{
    moduleId: string
    adapters: InboxOpsSourceAdapter[]
  }>
  export const inboxOpsSourceAdapters: InboxOpsSourceAdapter[]
  export function getInboxOpsSourceAdapter(sourceEntityType: string): InboxOpsSourceAdapter | undefined
}
