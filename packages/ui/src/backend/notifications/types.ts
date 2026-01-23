export type NotificationDto = {
  id: string
  type: string
  title: string
  body?: string | null
  icon?: string | null
  severity: string
  status: string
  actions: Array<{
    id: string
    label: string
    variant?: string
    icon?: string
  }>
  primaryActionId?: string
  sourceModule?: string | null
  sourceEntityType?: string | null
  sourceEntityId?: string | null
  linkHref?: string | null
  createdAt: string
  readAt?: string | null
  actionTaken?: string | null
}
