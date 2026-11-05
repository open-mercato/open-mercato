export const applicationLifecycleEvents = {
  bootstrapStarted: 'application.bootstrap.started',
  bootstrapCompleted: 'application.bootstrap.completed',
  bootstrapFailed: 'application.bootstrap.failed',
  requestReceived: 'application.request.received',
  requestAuthResolved: 'application.request.auth_resolved',
  requestAuthorizationDenied: 'application.request.authorization_denied',
  requestRateLimited: 'application.request.rate_limited',
  requestNotFound: 'application.request.not_found',
  requestCompleted: 'application.request.completed',
  requestFailed: 'application.request.failed',
} as const

export type ApplicationLifecycleEventId =
  (typeof applicationLifecycleEvents)[keyof typeof applicationLifecycleEvents]
