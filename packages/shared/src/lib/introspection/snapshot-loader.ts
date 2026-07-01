import type { IntrospectionSnapshot } from './types'

export type IntrospectionSnapshotField = keyof IntrospectionSnapshot

export type IntrospectionSnapshotLoader = (
  fields: IntrospectionSnapshotField[],
) => Promise<Partial<IntrospectionSnapshot>>

let registeredLoader: IntrospectionSnapshotLoader | null = null

export function registerIntrospectionSnapshotLoader(loader: IntrospectionSnapshotLoader): void {
  registeredLoader = loader
}

export function resetIntrospectionSnapshotLoader(): void {
  registeredLoader = null
}

export async function loadIntrospectionSnapshot(
  fields: IntrospectionSnapshotField[],
): Promise<IntrospectionSnapshot> {
  const snapshot: IntrospectionSnapshot = {
    notificationTypes: [],
    aiToolConfigEntries: [],
    messageTypes: [],
  }

  const uniqueFields = [...new Set(fields)]
  if (uniqueFields.length === 0 || !registeredLoader) {
    return snapshot
  }

  const loaded = await registeredLoader(uniqueFields)
  if (loaded.notificationTypes) snapshot.notificationTypes = loaded.notificationTypes
  if (loaded.aiToolConfigEntries) snapshot.aiToolConfigEntries = loaded.aiToolConfigEntries
  if (loaded.messageTypes) snapshot.messageTypes = loaded.messageTypes
  return snapshot
}
