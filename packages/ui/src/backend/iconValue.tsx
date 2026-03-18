import * as React from 'react'

export type SerializedBackendIcon = {
  html: string
}

export type BackendIconValue = React.ReactNode | SerializedBackendIcon

export function isSerializedBackendIcon(icon: BackendIconValue | undefined): icon is SerializedBackendIcon {
  return (
    typeof icon === 'object' &&
    icon !== null &&
    !React.isValidElement(icon) &&
    'html' in icon &&
    typeof (icon as { html?: unknown }).html === 'string'
  )
}

export function renderBackendIcon(icon: BackendIconValue | undefined): React.ReactNode | null {
  if (icon == null || icon === false) return null
  if (isSerializedBackendIcon(icon)) {
    return <span aria-hidden className="inline-flex shrink-0" dangerouslySetInnerHTML={{ __html: icon.html }} />
  }
  return icon
}
