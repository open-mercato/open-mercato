export type ModuleEncryptionFieldRule = {
  field: string
  hashField?: string | null
}

export type ModuleEncryptionMap = {
  entityId: string
  fields: ModuleEncryptionFieldRule[]
}
