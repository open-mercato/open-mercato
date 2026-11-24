const attemptIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

export function readStaffSignInAttemptId(eventName: string, payload: unknown): string | null {
  if (eventName !== 'auth.login.success' && eventName !== 'auth.login.failed') return null
  if (!payload || typeof payload !== 'object' || !('attemptId' in payload)) return null
  return typeof payload.attemptId === 'string' && attemptIdPattern.test(payload.attemptId)
    ? payload.attemptId
    : null
}
