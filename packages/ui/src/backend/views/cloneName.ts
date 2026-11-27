export type CloneNameSource = { name: string }

export type RoleCloneNameSource = { name: string; roleId: string }

export function buildCloneName(originalName: string, copyNumber: number): string {
  return copyNumber <= 1 ? `${originalName} (copy)` : `${originalName} (copy ${copyNumber})`
}

export function collectTakenCloneNames(
  personal: readonly CloneNameSource[],
  rolePerspectives: readonly RoleCloneNameSource[],
  targetRoleIds: readonly string[],
): Set<string> {
  const targetRoles = new Set(targetRoleIds)
  const taken = new Set(personal.map((item) => item.name.trim()))
  for (const item of rolePerspectives) {
    if (targetRoles.has(item.roleId)) taken.add(item.name.trim())
  }
  return taken
}

export function findFreeCloneNumber(originalName: string, takenNames: ReadonlySet<string>, startAt = 1): number {
  let copyNumber = Math.max(1, startAt)
  while (takenNames.has(buildCloneName(originalName, copyNumber))) {
    copyNumber += 1
  }
  return copyNumber
}
