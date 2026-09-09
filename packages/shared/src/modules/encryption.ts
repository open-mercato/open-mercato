export type ModuleEncryptionFieldRule = {
  field: string
  hashField?: string | null
}

export type EncryptionKeyScope = 'tenant' | 'system'

export type ModuleEncryptionMap = {
  entityId: string
  keyScope?: EncryptionKeyScope
  fields: ModuleEncryptionFieldRule[]
}
