Ticket — subject: "Still can't process payouts", body: "Third day our payouts are stuck and
support hasn't replied." customerEmail: vip@acme.test

History (from agent_examples.lookup_ticket_history): openTickets 3, resolvedLast30Days 1,
averageResolutionHours 41, churnRisk high, vip true.

Proposed action: assign_specialist
Payload: team=billing
Confidence: 0.85
Deciding signal: VIP with high churn risk and 3 open tickets on a money-blocking payout issue.
Rationale: a VIP whose payouts are blocked and who is already at high churn risk must go
straight to the billing specialists rather than wait in the general queue.
