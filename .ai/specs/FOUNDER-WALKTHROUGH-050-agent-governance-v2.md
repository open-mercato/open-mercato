# Founder Walkthrough + FAQ

**Topic**: Agent Governance V2 for Open Mercato  
**Audience**: Non-technical founders and board stakeholders  
**Last updated**: 2026-03-03

---

## 1) Why We Are Building This

Most companies save final outcomes, but not the reasoning behind decisions.  
That creates repeated mistakes, slow onboarding, and weak organizational memory.

We want one system that:
- helps us act faster,
- keeps humans in control,
- and remembers why decisions were made so we improve over time.

Simple goal:
**Not just automation. A company brain that can act and remember.**

---

## 2) What Exactly We Are Building

We are building one Open Mercato module with three parts:

1. **Operator**  
Runs workflows and tasks.

2. **Memory**  
Saves what was decided and why.

3. **Control Room**  
Lets humans approve, pause, stop, or override actions.

This is one unified system (not disconnected tools).

---

## 3) How It Works in Daily Operations

Example: deciding whether to grant a customer exception.

1. A case starts.
2. The system gathers relevant context and similar past cases.
3. It proposes an action with reasons.
4. It checks risk.
- Low risk: can proceed (if allowed).
- Higher risk: waits for human approval.
5. Human can intervene any time.
6. The final action is executed in Open Mercato.
7. The system stores what happened and why.

Result: faster decisions, clearer accountability, reusable precedent.

---

## 4) How We Keep Humans in Control

We use strict control levels:

1. **Observe**: collect and analyze only.
2. **Recommend**: suggest, human decides.
3. **Act**: automate only approved low-risk actions.

Control principles:
- High-risk actions must pause for human approval.
- Humans can always pause/resume/reject/terminate.
- Important actions always leave a trace for review.

Rule of thumb:
**Speed where safe, humans where risky.**

---

## 5) How the System Learns Over Time (Without Noise)

The system improves by learning from:
- past decisions,
- decision reasons,
- outcomes.

Learning loop:
1. Capture decisions.
2. Detect patterns.
3. Turn strong patterns into reusable playbooks/skills.
4. Reuse carefully with risk checks.
5. Measure and improve monthly.

To avoid noise:
- light logging for low-impact routine actions,
- rich logging for high-impact or unusual decisions.

---

## 6) Rollout Plan (Low-Risk, Practical)

We roll out in stages:

1. **Foundation (Dormant/Passive)**  
Integrated, collecting decision memory, no autonomous action.

2. **Advisor Mode**  
System recommends, humans decide everything.

3. **Controlled Automation**  
Only selected low-risk actions can run automatically.

4. **Skill Expansion**  
Add and validate higher-value skills.

5. **Continuous Improvement**  
Monthly tuning of policies, skills, and outcomes.

This avoids “pilot chaos” and keeps confidence high.

---

## 7) Open Source Strategy

What we can open source:
- module framework,
- control patterns,
- decision memory structure,
- basic retrieval and skill lifecycle.

What stays private (our advantage):
- our decision playbooks,
- our exception logic,
- our company-specific skill packs,
- our data and performance history.

Model:
**Open source the engine, keep proprietary intelligence private.**

---

## FAQ (From Our Planning Discussion)

### Q1) Do we record boring day-to-day stuff too?
Yes, but selectively.  
We only capture what helps audit, explanation, reuse, or improvement.

Three capture levels:
1. Basic receipt (what happened).
2. Decision note (what + short why).
3. Full case file (for high-impact/risky decisions).

---

### Q2) Can we integrate now and not use it until later?
Yes.  
We can install it in passive mode now, gather knowledge safely, and activate later in stages.

---

### Q3) If system was dormant for 6 months, can we review past cases later?
Yes.  
We can replay historical cases and compare:
- what humans decided then,
- what the system would recommend now.

Note: replay quality is strongest when decision context was captured from day one.

---

### Q4) How is this connected to Open Mercato in practice?
It is a module inside Open Mercato, not a separate product.  
Open Mercato remains the source of truth for business records.  
This module becomes the source of truth for decision reasoning/history.

---

### Q5) Where do humans see and control it: dashboard or Claude?
Both, with clear roles:
- **Open Mercato dashboard**: official control and operations.
- **Claude/agent interface**: analysis, investigation, and deep queries.

Primary control stays in Open Mercato.

---

### Q6) Can we add “McKinsey-style” skills (for example MECE)?
Yes.

How it works:
1. Skill is designed/coded.
2. Skill is governed and approved in Open Mercato.
3. Skill is executed by the agent runtime during real tasks.

So:
- build/update via coding,
- govern via dashboard,
- execute via agent runtime.

---

### Q7) Will this block teams and slow work?
It should not, if configured correctly.

Design rule:
- low-risk routine work stays lightweight,
- high-risk work gets stronger controls.

That keeps speed high while protecting critical decisions.

---

### Q8) Is this basically “decision telemetry”?
Yes.  
In plain terms: we capture decision trails so we can explain, audit, and improve future decisions.

---

### Q9) Is this a Frankenstein system?
No, if we keep one architecture rule:
**one module, one control room, one memory model, one task system.**

This is why we consolidated planning into one master task file.

---

### Q10) What is our single execution truth now?
This PRD walkthrough aligns with:
- spec: `.ai/specs/SPEC-050-2026-03-03-agentic-operations-and-governance-module.md`
- tasks: `tasks/tasks-agent-governance-v2-full-prd.md`

Operationally, the master task file is the implementation checklist.

---

## Final Summary (Founder Version)

We are building a controlled decision system inside Open Mercato that can:
- assist people now,
- automate safely later,
- and continuously improve because it remembers why decisions were made.

We can start dormant, learn first, then activate with confidence.
