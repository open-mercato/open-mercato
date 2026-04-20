export function reloadPage(): void {
  if (typeof window !== 'undefined') {
    window.location.reload()
  }
}
