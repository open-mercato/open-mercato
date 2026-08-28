import { NextResponse } from 'next/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { PrivacyServiceError } from '../services/errors'

export function privacyApiError(error: unknown): Response {
  if (error instanceof PrivacyServiceError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
  }
  if (isCrudHttpError(error)) {
    return NextResponse.json(error.body, { status: error.status })
  }
  return NextResponse.json({ error: 'Privacy operation failed', code: 'PRIVACY_OPERATION_FAILED' }, { status: 500 })
}
