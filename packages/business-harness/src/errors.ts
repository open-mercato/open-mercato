export type HarnessErrorCode =
  | 'AUTHENTICATION_FAILED'
  | 'INVALID_REQUEST'
  | 'POLICY_VIOLATION'
  | 'CONFIGURATION_ERROR'
  | 'CREDENTIAL_EXCHANGE_FAILED'
  | 'CONNECTOR_FAILED'
  | 'MODEL_FAILED'
  | 'RUN_TIMEOUT'
  | 'RUN_ABORTED'
  | 'INTERNAL_ERROR';

export class HarnessError extends Error {
  readonly code: HarnessErrorCode;
  readonly statusCode: number;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: HarnessErrorCode,
    message: string,
    options: {
      cause?: unknown;
      statusCode?: number;
      details?: Readonly<Record<string, unknown>>;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'HarnessError';
    this.code = code;
    this.statusCode = options.statusCode ?? defaultStatusCode(code);
    this.details = options.details;
  }
}

function defaultStatusCode(code: HarnessErrorCode): number {
  switch (code) {
    case 'AUTHENTICATION_FAILED':
      return 401;
    case 'INVALID_REQUEST':
      return 400;
    case 'POLICY_VIOLATION':
      return 422;
    case 'RUN_TIMEOUT':
      return 504;
    case 'RUN_ABORTED':
      return 499;
    case 'CONFIGURATION_ERROR':
    case 'CREDENTIAL_EXCHANGE_FAILED':
    case 'CONNECTOR_FAILED':
    case 'MODEL_FAILED':
      return 502;
    default:
      return 500;
  }
}

export function toHarnessError(error: unknown): HarnessError {
  if (error instanceof HarnessError) return error;
  if (error instanceof Error && error.name === 'AbortError') {
    return new HarnessError('RUN_ABORTED', 'Agent execution was aborted', { cause: error });
  }
  return new HarnessError('INTERNAL_ERROR', 'Unexpected agent runtime failure', { cause: error });
}

export function publicError(error: unknown): {
  code: HarnessErrorCode;
  message: string;
  details?: Readonly<Record<string, unknown>>;
} {
  const normalized = toHarnessError(error);
  return {
    code: normalized.code,
    message: normalized.message,
    ...(normalized.details ? { details: normalized.details } : {}),
  };
}

