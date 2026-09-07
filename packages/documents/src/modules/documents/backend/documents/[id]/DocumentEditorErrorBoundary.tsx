"use client"

import * as React from 'react'

type DocumentEditorErrorBoundaryProps = {
  children: React.ReactNode
  fallback: (retry: () => void) => React.ReactNode
  onRetry: () => void
  resetKey: string
}
type DocumentEditorErrorBoundaryState = {
  failed: boolean
}

export class DocumentEditorErrorBoundary extends React.Component<
  DocumentEditorErrorBoundaryProps,
  DocumentEditorErrorBoundaryState
> {
  state: DocumentEditorErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): DocumentEditorErrorBoundaryState {
    return { failed: true }
  }

  componentDidUpdate(previous: DocumentEditorErrorBoundaryProps) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false })
    }
  }

  private retry = () => {
    this.setState({ failed: false })
    this.props.onRetry()
  }

  render() {
    return this.state.failed ? this.props.fallback(this.retry) : this.props.children
  }
}
