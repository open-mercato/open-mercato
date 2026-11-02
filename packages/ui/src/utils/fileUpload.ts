export type FileRejection = { file: File; reason: 'type' | 'size' | 'count' }

export type FileSelectionOptions = {
  accept?: string
  multiple?: boolean
  maxSizeBytes?: number
}

export function selectUploadFiles(files: readonly File[], { accept, multiple = true, maxSizeBytes }: FileSelectionOptions = {}) {
  const types = (accept ?? '').split(',').map(type => type.trim().toLowerCase()).filter(Boolean)
  const accepted: File[] = []
  const rejected: FileRejection[] = []
  for (const file of files) {
    const matchesType = types.length === 0 || types.some(type => {
      if (type.startsWith('.')) return file.name.toLowerCase().endsWith(type)
      if (type.endsWith('/*')) return file.type.toLowerCase().startsWith(type.slice(0, -1))
      return file.type.toLowerCase() === type
    })
    if (!matchesType) rejected.push({ file, reason: 'type' })
    else if (maxSizeBytes !== undefined && file.size > maxSizeBytes) rejected.push({ file, reason: 'size' })
    else if (!multiple && accepted.length > 0) rejected.push({ file, reason: 'count' })
    else accepted.push(file)
  }
  return { accepted, rejected }
}
