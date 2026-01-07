export const escapeLikePattern = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/[%_]/g, '\\$&')
