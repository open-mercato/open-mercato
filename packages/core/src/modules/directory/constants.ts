export const ALL_ORGANIZATIONS_COOKIE_VALUE = '__all__'

export function isAllOrganizationsSelection(value: string | null | undefined): boolean {
  return value === ALL_ORGANIZATIONS_COOKIE_VALUE
}
