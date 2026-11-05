type DictionaryDefault = {
  value: string
  label: string
  color?: string
  icon?: string
}

export const DEAL_STATUS_DEFAULTS: DictionaryDefault[] = [
  { value: 'open', label: 'Open', color: '#2563eb', icon: 'lucide:circle' },
  { value: 'closed', label: 'Closed', color: '#6b7280', icon: 'lucide:check-circle' },
  { value: 'win', label: 'Win', color: '#22c55e', icon: 'lucide:trophy' },
  { value: 'lost', label: 'Lost', color: '#ef4444', icon: 'lucide:flag' },
  { value: 'in_progress', label: 'In progress', color: '#f59e0b', icon: 'lucide:activity' },
]

export const PIPELINE_STAGE_DEFAULTS: DictionaryDefault[] = [
  { value: 'opportunity', label: 'Opportunity', color: '#38bdf8', icon: 'lucide:target' },
  { value: 'marketing_qualified_lead', label: 'Marketing Qualified Lead', color: '#a855f7', icon: 'lucide:sparkles' },
  { value: 'sales_qualified_lead', label: 'Sales Qualified Lead', color: '#f97316', icon: 'lucide:users' },
  { value: 'offering', label: 'Offering', color: '#22c55e', icon: 'lucide:package' },
  { value: 'negotiations', label: 'Negotiations', color: '#facc15', icon: 'lucide:handshake' },
  { value: 'win', label: 'Win', color: '#16a34a', icon: 'lucide:award' },
  { value: 'lost', label: 'Lost', color: '#ef4444', icon: 'lucide:flag' },
  { value: 'stalled', label: 'Stalled', color: '#6b7280', icon: 'lucide:alert-circle' },
]

export const ENTITY_STATUS_DEFAULTS: DictionaryDefault[] = [
  { value: 'active', label: 'Active', color: '#22c55e', icon: 'lucide:user-check' },
  { value: 'inactive', label: 'Inactive', color: '#94a3b8', icon: 'lucide:pause-circle' },
  { value: 'pending', label: 'Pending', color: '#f59e0b', icon: 'lucide:clock' },
  { value: 'archived', label: 'Archived', color: '#64748b', icon: 'lucide:archive' },
]

export const ENTITY_LIFECYCLE_STAGE_DEFAULTS: DictionaryDefault[] = [
  { value: 'lead', label: 'Lead', color: '#3b82f6', icon: 'lucide:sparkles' },
  { value: 'prospect', label: 'Prospect', color: '#8b5cf6', icon: 'lucide:eye' },
  { value: 'customer', label: 'Customer', color: '#22c55e', icon: 'lucide:handshake' },
  { value: 'subscriber', label: 'Subscriber', color: '#10b981', icon: 'lucide:bell' },
  { value: 'churned', label: 'Churned', color: '#ef4444', icon: 'lucide:user-x' },
  { value: 'other', label: 'Other', color: '#94a3b8', icon: 'lucide:circle' },
]

export const ENTITY_SOURCE_DEFAULTS: DictionaryDefault[] = [
  { value: 'linkedin', label: 'LinkedIn', color: '#0a66c2', icon: 'lucide:linkedin' },
  { value: 'email', label: 'Email', color: '#3b82f6', icon: 'lucide:mail' },
  { value: 'web_form', label: 'Web form', color: '#22c55e', icon: 'lucide:globe' },
  { value: 'referral', label: 'Referral', color: '#8b5cf6', icon: 'lucide:users' },
  { value: 'customer_referral', label: 'Customer referral', color: '#22c55e', icon: 'lucide:thumbs-up' },
  { value: 'partner_referral', label: 'Partner referral', color: '#3b82f6', icon: 'lucide:handshake' },
  { value: 'event', label: 'Conference / Event', color: '#f59e0b', icon: 'lucide:calendar' },
  { value: 'cold_outreach', label: 'Cold outreach', color: '#94a3b8', icon: 'lucide:phone' },
  { value: 'facebook', label: 'Facebook', color: '#1877f2', icon: 'lucide:facebook' },
  { value: 'typeform', label: 'Typeform', color: '#262627', icon: 'lucide:file-text' },
  { value: 'other', label: 'Other', color: '#64748b', icon: 'lucide:circle' },
]

export const ADDRESS_TYPE_DEFAULTS: DictionaryDefault[] = [
  { value: 'office', label: 'Office', color: '#3b82f6', icon: 'lucide:building' },
  { value: 'work', label: 'Work', color: '#6366f1', icon: 'lucide:briefcase' },
  { value: 'billing', label: 'Billing', color: '#f97316', icon: 'lucide:wallet' },
  { value: 'shipping', label: 'Shipping', color: '#22c55e', icon: 'lucide:truck' },
  { value: 'home', label: 'Home', color: '#10b981', icon: 'lucide:map-pin' },
]

export const ACTIVITY_TYPE_DEFAULTS: DictionaryDefault[] = [
  { value: 'call', label: 'Call', color: '#2563eb', icon: 'lucide:phone-call' },
  { value: 'email', label: 'Email', color: '#16a34a', icon: 'lucide:mail' },
  { value: 'event', label: 'Event', color: '#6366f1', icon: 'lucide:calendar' },
  { value: 'meeting', label: 'Meeting', color: '#f59e0b', icon: 'lucide:users' },
  { value: 'note', label: 'Note', color: '#a855f7', icon: 'lucide:notebook' },
  { value: 'task', label: 'Task', color: '#ef4444', icon: 'lucide:check-square' },
]

export const INTERACTION_STATUS_DEFAULTS: DictionaryDefault[] = [
  { value: 'planned', label: 'Planned', color: '#2563eb', icon: 'lucide:circle' },
  { value: 'in_progress', label: 'In progress', color: '#f59e0b', icon: 'lucide:activity' },
  { value: 'waiting', label: 'Waiting / blocked', color: '#a855f7', icon: 'lucide:pause-circle' },
  { value: 'done', label: 'Done', color: '#22c55e', icon: 'lucide:check-circle' },
  { value: 'canceled', label: 'Canceled', color: '#6b7280', icon: 'lucide:x-circle' },
]

export const JOB_TITLE_DEFAULTS: DictionaryDefault[] = [
  { value: 'Director of Operations', label: 'Director of Operations', color: '#f97316', icon: 'lucide:settings' },
  { value: 'VP of Partnerships', label: 'VP of Partnerships', color: '#6366f1', icon: 'lucide:users' },
  { value: 'Founder & Principal', label: 'Founder & Principal', color: '#ec4899', icon: 'lucide:star' },
  { value: 'Senior Project Manager', label: 'Senior Project Manager', color: '#0ea5e9', icon: 'lucide:clipboard-list' },
  { value: 'Chief Revenue Officer', label: 'Chief Revenue Officer', color: '#8b5cf6', icon: 'lucide:bar-chart-3' },
  { value: 'Director of Retail Partnerships', label: 'Director of Retail Partnerships', color: '#f59e0b', icon: 'lucide:shopping-bag' },
]

export const INDUSTRY_DEFAULTS: DictionaryDefault[] = [
  { value: 'Renewable Energy', label: 'Renewable Energy' },
  { value: 'Software', label: 'Software' },
  { value: 'Interior Design', label: 'Interior Design' },
  { value: 'SaaS', label: 'SaaS' },
  { value: 'E-commerce', label: 'E-commerce' },
  { value: 'Healthcare', label: 'Healthcare' },
  { value: 'Manufacturing', label: 'Manufacturing' },
  { value: 'Logistics', label: 'Logistics' },
  { value: 'Financial Services', label: 'Financial Services' },
  { value: 'Retail', label: 'Retail' },
  { value: 'Hospitality', label: 'Hospitality' },
  { value: 'Energy', label: 'Energy' },
  { value: 'Media', label: 'Media' },
]

export const TEMPERATURE_DEFAULTS: DictionaryDefault[] = [
  { value: 'hot', label: 'Hot', color: '#ef4444', icon: 'lucide:flame' },
  { value: 'high', label: 'High', color: '#f59e0b', icon: 'lucide:trending-up' },
  { value: 'medium', label: 'Medium', color: '#8b5cf6', icon: 'lucide:sparkles' },
  { value: 'low', label: 'Low', color: '#64748b', icon: 'lucide:clock' },
  { value: 'cold', label: 'Cold', color: '#94a3b8', icon: 'lucide:snowflake' },
]

export const PERSON_COMPANY_ROLE_DEFAULTS = [
  { value: 'decision_maker', label: 'Decision maker', color: '#f59e0b', icon: 'lucide:crown' },
  { value: 'influencer', label: 'Influencer', color: '#8b5cf6', icon: 'lucide:sparkles' },
  { value: 'budget_holder', label: 'Budget holder', color: '#3b82f6', icon: 'lucide:wallet' },
  { value: 'technical_evaluator', label: 'Technical evaluator', color: '#22c55e', icon: 'lucide:wrench' },
  { value: 'primary_contact', label: 'Primary contact', color: '#0ea5e9', icon: 'lucide:star' },
  { value: 'end_user', label: 'End user', color: '#64748b', icon: 'lucide:user' },
]

export const CUSTOMER_DICTIONARY_DEFAULTS: Record<string, readonly DictionaryDefault[]> = {
  status: ENTITY_STATUS_DEFAULTS,
  source: ENTITY_SOURCE_DEFAULTS,
  lifecycle_stage: ENTITY_LIFECYCLE_STAGE_DEFAULTS,
  address_type: ADDRESS_TYPE_DEFAULTS,
  activity_type: ACTIVITY_TYPE_DEFAULTS,
  interaction_status: INTERACTION_STATUS_DEFAULTS,
  job_title: JOB_TITLE_DEFAULTS,
  deal_status: DEAL_STATUS_DEFAULTS,
  pipeline_stage: PIPELINE_STAGE_DEFAULTS,
  industry: INDUSTRY_DEFAULTS,
  temperature: TEMPERATURE_DEFAULTS,
  person_company_role: PERSON_COMPANY_ROLE_DEFAULTS,
}
