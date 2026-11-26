import { companyTabNames, personTabNames } from '../lib/bundles.js'

export function fullCoverageArgs(name) {
  if (name === 'person.360') return { tabs: personTabNames() }
  if (name === 'company.360') return { tabs: companyTabNames() }
  if (name === 'search.list') return { allKinds: true }
  if (name === 'heavy.encrypted.sort') return { allVariants: true }
  return undefined
}
