export class UnknownTemplateError extends Error {
  constructor(readonly templateId: string) {
    super(`[internal] Unknown document template: ${templateId}`)
    this.name = 'UnknownTemplateError'
  }
}

export class UnknownTemplateVersionError extends Error {
  constructor(readonly templateId: string, readonly version: string) {
    super(`[internal] Unknown version ${version} of document template ${templateId}`)
    this.name = 'UnknownTemplateVersionError'
  }
}

export class DuplicateTemplateError extends Error {
  constructor(templateId: string, existingModule: string, incomingModule: string) {
    super(`[internal] Duplicate template ${templateId} from ${incomingModule}; already registered by ${existingModule}. Use module-prefixed template IDs.`)
    this.name = 'DuplicateTemplateError'
  }
}

export class TemplateAccessDeniedError extends Error {
  readonly requiredFeatures: string[]

  constructor(requiredFeatures: string[]) {
    super('[internal] Document template access denied')
    this.name = 'TemplateAccessDeniedError'
    this.requiredFeatures = [...requiredFeatures]
  }
}
