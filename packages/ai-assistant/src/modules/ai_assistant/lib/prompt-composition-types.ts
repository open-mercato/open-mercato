export type PromptSectionName =
  | 'role'
  | 'scope'
  | 'data'
  | 'tools'
  | 'attachments'
  | 'mutationPolicy'
  | 'responseStyle'
  | 'overrides'

export interface PromptSection {
  name: PromptSectionName
  content: string
  order?: number
}

export interface PromptTemplate {
  id: string
  sections: PromptSection[]
}

export function definePromptTemplate(template: PromptTemplate): PromptTemplate {
  return template
}
