export type TranslatorFn = (key: string, params?: Record<string, any>) => string

export type Action = {
  type: string
  config?: Record<string, any>
}

export type ValidationResult = {
  valid: boolean
  errors: string[]
}

/**
 * Available action types
 */
export const ACTION_TYPES = [
  'ALLOW_TRANSITION',
  'BLOCK_TRANSITION',
  'LOG',
  'SHOW_ERROR',
  'SHOW_WARNING',
  'SHOW_INFO',
  'NOTIFY',
  'SET_FIELD',
  'CALL_WEBHOOK',
  'EMIT_EVENT',
] as const

export type ActionType = (typeof ACTION_TYPES)[number]

/**
 * Get action type options for dropdown
 */
export function getActionTypeOptions(t: TranslatorFn): { value: string; label: string }[] {
  return [
    { value: 'ALLOW_TRANSITION', label: t('business_rules.validation.actionTypes.ALLOW_TRANSITION') },
    { value: 'BLOCK_TRANSITION', label: t('business_rules.validation.actionTypes.BLOCK_TRANSITION') },
    { value: 'LOG', label: t('business_rules.validation.actionTypes.LOG') },
    { value: 'SHOW_ERROR', label: t('business_rules.validation.actionTypes.SHOW_ERROR') },
    { value: 'SHOW_WARNING', label: t('business_rules.validation.actionTypes.SHOW_WARNING') },
    { value: 'SHOW_INFO', label: t('business_rules.validation.actionTypes.SHOW_INFO') },
    { value: 'NOTIFY', label: t('business_rules.validation.actionTypes.NOTIFY') },
    { value: 'SET_FIELD', label: t('business_rules.validation.actionTypes.SET_FIELD') },
    { value: 'CALL_WEBHOOK', label: t('business_rules.validation.actionTypes.CALL_WEBHOOK') },
    { value: 'EMIT_EVENT', label: t('business_rules.validation.actionTypes.EMIT_EVENT') },
  ]
}

/**
 * Get required config fields for an action type
 */
export function getRequiredConfigFields(actionType: string): string[] {
  switch (actionType) {
    case 'LOG':
    case 'SHOW_ERROR':
    case 'SHOW_WARNING':
    case 'SHOW_INFO':
      return ['message']
    case 'NOTIFY':
      return ['message', 'recipients']
    case 'SET_FIELD':
      return ['field', 'value']
    case 'CALL_WEBHOOK':
      return ['url']
    case 'EMIT_EVENT':
      return ['eventName']
    case 'ALLOW_TRANSITION':
    case 'BLOCK_TRANSITION':
    default:
      return []
  }
}

/**
 * Get optional config fields for an action type
 */
export function getOptionalConfigFields(actionType: string): string[] {
  switch (actionType) {
    case 'LOG':
      return ['level']
    case 'NOTIFY':
      return ['template']
    case 'CALL_WEBHOOK':
      return ['method', 'headers', 'body']
    case 'EMIT_EVENT':
      return ['payload']
    default:
      return []
  }
}

/**
 * Validate a single action
 */
export function validateAction(action: Action, t?: TranslatorFn): ValidationResult {
  const errors: string[] = []
  const translate = t || ((key: string) => key)

  if (!action) {
    errors.push(translate('business_rules.validation.action.required'))
    return { valid: false, errors }
  }

  if (!action.type || typeof action.type !== 'string') {
    errors.push(translate('business_rules.validation.action.typeRequired'))
  } else if (!ACTION_TYPES.includes(action.type as ActionType)) {
    errors.push(translate('business_rules.validation.action.unknownType', { type: action.type, validTypes: ACTION_TYPES.join(', ') }))
  }

  const requiredFields = getRequiredConfigFields(action.type)
  if (requiredFields.length > 0) {
    if (!action.config) {
      errors.push(translate('business_rules.validation.action.configRequired', { type: action.type, fields: requiredFields.join(', ') }))
    } else {
      requiredFields.forEach((field) => {
        if (!action.config![field]) {
          errors.push(translate('business_rules.validation.action.fieldMissing', { field }))
        }
      })
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Validate action config for a specific type
 */
export function validateActionConfig(actionType: string, config: Record<string, any> | undefined, t?: TranslatorFn): ValidationResult {
  const errors: string[] = []
  const translate = t || ((key: string) => key)

  const requiredFields = getRequiredConfigFields(actionType)
  if (requiredFields.length > 0 && !config) {
    errors.push(translate('business_rules.validation.action.configRequiredForType', { type: actionType }))
    return { valid: false, errors }
  }

  if (config) {
    requiredFields.forEach((field) => {
      if (!config[field]) {
        errors.push(translate('business_rules.validation.action.fieldMissingShort', { field }))
      }
    })
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Validate array of actions
 */
export function validateActions(actions: Action[] | null | undefined, t?: TranslatorFn): ValidationResult {
  if (!actions || actions.length === 0) {
    return { valid: true, errors: [] } // Empty is valid
  }

  const errors: string[] = []
  const translate = t || ((key: string) => key)

  actions.forEach((action, index) => {
    const result = validateAction(action, t)
    if (!result.valid) {
      errors.push(translate('business_rules.validation.action.indexError', { index: index + 1, errors: result.errors.join(', ') }))
    }
  })

  return {
    valid: errors.length === 0,
    errors,
  }
}
