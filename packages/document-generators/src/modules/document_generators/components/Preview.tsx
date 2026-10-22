"use client"

export type PreviewProps = {
  url: string
  title: string
}

export function Preview({ url, title }: PreviewProps) {
  return <iframe src={url} title={title} className="h-full min-h-96 w-full rounded border border-border bg-background" />
}
