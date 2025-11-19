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
export function getActionTypeOptions(): { value: string; label: string }[] {
  return [
    { value: 'ALLOW_TRANSITION', label: 'Allow Transition' },
    { value: 'BLOCK_TRANSITION', label: 'Block Transition' },
    { value: 'LOG', label: 'Log Message' },
    { value: 'SHOW_ERROR', label: 'Show Error' },
    { value: 'SHOW_WARNING', label: 'Show Warning' },
    { value: 'SHOW_INFO', label: 'Show Info' },
    { value: 'NOTIFY', label: 'Send Notification' },
    { value: 'SET_FIELD', label: 'Set Field Value' },
    { value: 'CALL_WEBHOOK', label: 'Call Webhook' },
    { value: 'EMIT_EVENT', label: 'Emit Event' },
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
export function validateAction(action: Action): ValidationResult {
  const errors: string[] = []

  if (!action) {
    errors.push('Action is required')
    return { valid: false, errors }
  }

  if (!action.type || typeof action.type !== 'string') {
    errors.push('Action type is required')
  }

  const requiredFields = getRequiredConfigFields(action.type)
  if (requiredFields.length > 0) {
    if (!action.config) {
      errors.push(`Action ${action.type} requires config with fields: ${requiredFields.join(', ')}`)
    } else {
      requiredFields.forEach((field) => {
        if (!action.config![field]) {
          errors.push(`Required field "${field}" is missing from config`)
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
export function validateActionConfig(actionType: string, config: Record<string, any> | undefined): ValidationResult {
  const errors: string[] = []

  const requiredFields = getRequiredConfigFields(actionType)
  if (requiredFields.length > 0 && !config) {
    errors.push(`Config is required for action type ${actionType}`)
    return { valid: false, errors }
  }

  if (config) {
    requiredFields.forEach((field) => {
      if (!config[field]) {
        errors.push(`Required field "${field}" is missing`)
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
export function validateActions(actions: Action[] | null | undefined): ValidationResult {
  if (!actions || actions.length === 0) {
    return { valid: true, errors: [] } // Empty is valid
  }

  const errors: string[] = []

  actions.forEach((action, index) => {
    const result = validateAction(action)
    if (!result.valid) {
      errors.push(`Action ${index + 1}: ${result.errors.join(', ')}`)
    }
  })

  return {
    valid: errors.length === 0,
    errors,
  }
}
