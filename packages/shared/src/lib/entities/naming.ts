export function tableNameFromEntityId(entityId: string): string {
  const [, name] = entityId.split(':')
  if (!name) return ''
  return name.endsWith('s') ? name : `${name}s`
}

