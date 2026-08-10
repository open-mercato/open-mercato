'use client'

interface PreviewProps {
  url: string
  title: string
}

export function Preview({ url, title }: PreviewProps) {
  return (
    <iframe
      src={url}
      title={title}
      className="h-full w-full border-0"
    />
  )
}
