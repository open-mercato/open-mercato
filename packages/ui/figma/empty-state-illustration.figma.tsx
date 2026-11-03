import React from 'react'
import figma from '@figma/code-connect'
import { EmptyStateIllustration } from '../src/primitives/empty-state-illustration'

figma.connect(EmptyStateIllustration, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=3860-5822', {
  imports: ["import { EmptyStateIllustration } from '@open-mercato/ui/primitives/empty-state-illustration'"],
  props: { kind: figma.enum('🧩 Type', {
    "📈 Stock Market Tracker": "finance-stock-market-tracker",
    "💳 My Cards": "finance-my-cards",
    "💸 Spending Summary": "finance-spending-summary",
    "💰 Exchange": "finance-exchange",
    "💶 Currency List": "finance-currency-list",
    "📊 Budget Overview": "finance-budget-overview",
    "📘 Saved Actions": "finance-saved-actions",
    "⏳ Recent Transactions": "finance-recent-transactions",
    "🔖 My Subscriptions": "finance-my-subscriptions",
    "🛫 Quick Transfer": "finance-quick-transfer",
    "💌 Donation Profile": "finance-donation-profile",
    "💳 My Cards Vertical": "finance-my-cards-vertical",
    "💰 Total Balance": "finance-total-balance",
    "💷 Total Expenses": "finance-total-expenses",
    "💸 Major Expenses": "finance-major-expenses",
    "💯 Credit Score": "finance-credit-score"
}) },
  example: ({ kind }) => <EmptyStateIllustration kind={kind} />,
})

figma.connect(EmptyStateIllustration, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=3860-4495', {
  imports: ["import { EmptyStateIllustration } from '@open-mercato/ui/primitives/empty-state-illustration'"],
  props: { kind: figma.enum('🧩 Type', {
    "⏰ Time Off": "hr-time-off",
    "⚡️ Current Project": "hr-current-project",
    "💻 Status Tracker": "hr-status-tracker",
    "📙 Notes": "hr-notes",
    "📅 Schedule Meetings": "hr-schedule-meetings",
    "📅 Schedule Events": "hr-schedule-events",
    "📅 Schedule Holiday": "hr-schedule-holiday",
    "👩‍💻 Employee Spotlight Overview": "hr-employee-spotlight-overview",
    "👩‍💻 Employee Comments": "hr-employee-comments",
    "👩‍💻 Employee Rewards": "hr-employee-rewards",
    "🕐 Time Tracker": "hr-time-tracker",
    "💬 Daily Feedback": "hr-daily-feedback",
    "📊 Work Hour Analysis": "hr-work-hour-analysis",
    "📚 Courses": "hr-courses",
    "🕰️ Daily Work Hours": "hr-daily-work-hours",
    "📖 Course Progress": "hr-course-progress",
    "💪 Training Analysis": "hr-training-analysis",
    "🌟 Employee Rating": "hr-employee-rating"
}) },
  example: ({ kind }) => <EmptyStateIllustration kind={kind} />,
})

