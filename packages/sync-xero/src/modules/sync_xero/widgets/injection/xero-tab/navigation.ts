"use client"

export function navigateToXero(authorizeUrl: string): void {
  window.location.assign(authorizeUrl)
}
