import { validateSchemaExtensions, type FormSchema } from './schema-helpers'

export type AutosaveGuard = {
  run: (schema: FormSchema) => Promise<void>
}

export function createAutosaveGuard({
  patch,
  onInvalid,
}: {
  patch: (schema: FormSchema) => Promise<void> | void
  onInvalid: () => void
}): AutosaveGuard {
  return {
    async run(schema) {
      try {
        validateSchemaExtensions(schema)
      } catch {
        onInvalid()
        return
      }
      await patch(schema)
    },
  }
}
