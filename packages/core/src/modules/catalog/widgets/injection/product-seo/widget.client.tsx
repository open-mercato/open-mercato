"use client"
import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'

export default function ProductSeoWidget({ context, data }: InjectionWidgetComponentProps) {
  const title = (data?.title || data?.name || '') as string
  const description = (data?.description || '') as string
  
  const titleScore = React.useMemo(() => {
    if (!title) return { text: 'Missing', color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' }
    if (title.length < 10) return { text: 'Too short', color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' }
    if (title.length > 60) return { text: 'Too long', color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' }
    return { text: 'Good', color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' }
  }, [title])
  
  const descScore = React.useMemo(() => {
    if (!description) return { text: 'Missing', color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' }
    if (description.length < 50) return { text: 'Too short', color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' }
    return { text: 'Good', color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' }
  }, [description])
  
  return (
    <div className={`rounded border p-3 text-sm ${titleScore.bg} ${titleScore.border}`}>
      <div className="font-medium text-gray-900">SEO Optimization</div>
      <div className="mt-2 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-gray-700">Title ({title.length} chars):</span>
          <span className={`font-medium ${titleScore.color}`}>{titleScore.text}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-700">Description ({description.length} chars):</span>
          <span className={`font-medium ${descScore.color}`}>{descScore.text}</span>
        </div>
      </div>
      <div className="mt-2 text-xs text-gray-600">
        Optimal: Title 10-60 chars, Description 50+ chars
      </div>
    </div>
  )
}
