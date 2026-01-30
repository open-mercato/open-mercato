export const NOTIFICATION_DOM_EVENTS = {
  NEW: 'om:notifications:new',
  ACTIONED: 'om:notifications:actioned',
  COUNT_CHANGED: 'om:notifications:count-changed',
} as const

export type NotificationNewDetail = {
  id: string
  type: string
  title: string
  severity: string
}

export function emitNotificationNew(detail: NotificationNewDetail): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return
  window.dispatchEvent(new CustomEvent(NOTIFICATION_DOM_EVENTS.NEW, { detail }))
}

export function emitNotificationActioned(notificationId: string): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return
  window.dispatchEvent(new CustomEvent(NOTIFICATION_DOM_EVENTS.ACTIONED, { detail: { notificationId } }))
}

export function emitNotificationCountChanged(count: number): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return
  window.dispatchEvent(new CustomEvent(NOTIFICATION_DOM_EVENTS.COUNT_CHANGED, { detail: { count } }))
}

export function subscribeNotificationNew(handler: (detail: NotificationNewDetail) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (event: Event) => handler((event as CustomEvent<NotificationNewDetail>).detail)
  window.addEventListener(NOTIFICATION_DOM_EVENTS.NEW, listener)
  return () => window.removeEventListener(NOTIFICATION_DOM_EVENTS.NEW, listener)
}

export function subscribeNotificationActioned(handler: (notificationId: string) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (event: Event) => handler((event as CustomEvent<{ notificationId: string }>).detail.notificationId)
  window.addEventListener(NOTIFICATION_DOM_EVENTS.ACTIONED, listener)
  return () => window.removeEventListener(NOTIFICATION_DOM_EVENTS.ACTIONED, listener)
}

export function subscribeNotificationCountChanged(handler: (count: number) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (event: Event) => handler((event as CustomEvent<{ count: number }>).detail.count)
  window.addEventListener(NOTIFICATION_DOM_EVENTS.COUNT_CHANGED, listener)
  return () => window.removeEventListener(NOTIFICATION_DOM_EVENTS.COUNT_CHANGED, listener)
}
