import { MetadataStorage } from '@mikro-orm/core'
import { getOrmEntities } from '@open-mercato/shared/lib/db/mikro'
export function backupEntityLabels(): Record<string, string> {
  getOrmEntities()
  const labels: Record<string, string> = {}
  for (const metadata of Object.values(MetadataStorage.getMetadata())) {
    if (!metadata.tableName) continue
    const module = metadata.path?.match(/[/\\]modules[/\\]([^/\\]+)/)?.[1]
    labels[`${metadata.schema ?? 'public'}.${metadata.tableName}`] = module ? `${module} · ${metadata.className}` : metadata.className
  }
  return labels
}
