"use client"
import * as React from 'react'

export function ConfirmDialog({ trigger, title = 'Are you sure?', description, onConfirm }: {
  trigger: React.ReactNode
  title?: string
  description?: string
  onConfirm: () => void
}) {
  const onClick = (e: React.MouseEvent) => {
    e.preventDefault()
    if (window.confirm(`${title}\n${description ?? ''}`.trim())) onConfirm()
  }
  return <span onClick={onClick}>{trigger}</span>
}

