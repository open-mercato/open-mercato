"use client"

import * as React from 'react'
import type { CrudFormGroupComponentProps } from '@open-mercato/ui/backend/CrudForm'
import { slugify } from '@open-mercato/shared/lib/slugify'

const readString = (value: unknown): string => {
  if (typeof value === 'string') return value
  return ''
}

export function CategorySlugFieldSync({ values, setValue }: CrudFormGroupComponentProps) {
  const autoModeRef = React.useRef(true)
  const lastAutoSlugRef = React.useRef('')
  const slugValue = readString(values.slug)
  const nameValue = readString(values.name)

  React.useEffect(() => {
    if (!slugValue) {
      autoModeRef.current = true
      lastAutoSlugRef.current = ''
      return
    }
    if (slugValue === lastAutoSlugRef.current) {
      autoModeRef.current = true
    } else {
      autoModeRef.current = false
    }
  }, [slugValue])

  React.useEffect(() => {
    if (!autoModeRef.current) return
    if (!nameValue) {
      if (slugValue) {
        setValue('slug', '')
      }
      lastAutoSlugRef.current = ''
      return
    }
    const nextSlug = slugify(nameValue)
    lastAutoSlugRef.current = nextSlug
    if (slugValue !== nextSlug) {
      setValue('slug', nextSlug)
    }
  }, [nameValue, setValue, slugValue])

  return null
}
