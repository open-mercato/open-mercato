export function revokeObjectUrlAfterNavigation(url: string): void {
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    revokeObjectUrlAfterNavigation(url)
  }
}
