export const formatCategoryLabel = (name: string | null | undefined, fallback: string, parentName?: string | null) => {
  const base = typeof name === 'string' && name.trim().length ? name.trim() : fallback
  const parent = typeof parentName === 'string' && parentName.trim().length ? parentName.trim() : null
  return parent ? `${base} / ${parent}` : base
}
