import type { InboxOpsSourceAdapter } from '@open-mercato/shared/modules/inbox-ops-sources'

type GeneratedSourceRegistry = {
  getInboxOpsSourceAdapter?: (sourceEntityType: string) => InboxOpsSourceAdapter | undefined
}

let registryPromise: Promise<GeneratedSourceRegistry | null> | null = null

async function loadSourceRegistry(): Promise<GeneratedSourceRegistry | null> {
  if (!registryPromise) {
    registryPromise = import('@/.mercato/generated/inbox-ops-sources.generated')
      .then((mod) => mod as GeneratedSourceRegistry)
      .catch(() => null)
  }

  return registryPromise
}

export async function getInboxOpsSourceAdapter(
  sourceEntityType: string,
): Promise<InboxOpsSourceAdapter | undefined> {
  const registry = await loadSourceRegistry()
  return registry?.getInboxOpsSourceAdapter?.(sourceEntityType)
}
