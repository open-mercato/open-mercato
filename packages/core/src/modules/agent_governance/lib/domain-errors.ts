import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

export class AgentGovernanceDomainError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status = 400) {
    super(message)
    this.name = 'AgentGovernanceDomainError'
    this.code = code
    this.status = status
  }
}

export class PolicyViolationError extends AgentGovernanceDomainError {
  constructor(message: string, code = 'POLICY_VIOLATION') {
    super(code, message, 409)
    this.name = 'PolicyViolationError'
  }
}

export class ApprovalStateError extends AgentGovernanceDomainError {
  constructor(message: string, code = 'APPROVAL_STATE_INVALID') {
    super(code, message, 409)
    this.name = 'ApprovalStateError'
  }
}

export class HarnessCapabilityError extends AgentGovernanceDomainError {
  constructor(message: string, code = 'HARNESS_CAPABILITY_UNAVAILABLE') {
    super(code, message, 422)
    this.name = 'HarnessCapabilityError'
  }
}

export function toCrudHttpError(error: AgentGovernanceDomainError): CrudHttpError {
  return new CrudHttpError(error.status, {
    error: error.message,
    code: error.code,
  })
}
