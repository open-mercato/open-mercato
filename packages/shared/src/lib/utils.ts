import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

const mergeClasses = extendTailwindMerge({
  extend: {
    classGroups: { "font-size": [{ text: ["overline", "compact", "title-4", "ai-body"] }] },
    theme: { radius: ["alert", "content-card", "textarea", "upload", "selection-card", "ai-control", "ai-input", "ai-prompt", "ai-prompt-inner", "ai-prompt-mobile", "ai-prompt-mobile-inner"] },
  },
})

export function cn(...inputs: ClassValue[]) {
  return mergeClasses(clsx(inputs))
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function slugifyTagLabel(label: string): string {
  return (
    label
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(?:^-+|-+$)/g, "")
      .slice(0, 80) || `tag-${Math.random().toString(36).slice(2, 10)}`
  )
}
