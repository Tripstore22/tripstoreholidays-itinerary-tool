---
name: tripstore-sales
description: TripStore agent-closing and go-to-market playbook, CEO and CMO frame. Use this skill whenever the task is about acquiring, onboarding, activating, or converting travel agents, WhatsApp outreach campaigns, sales or marketing messaging, demo scripts, objection handling, pricing communication, agent segmentation, or partnership pitches (e.g. tourism offices). It holds the hard reality (live agents but zero paying — closing agents is the real bottleneck, not features), the locked USP arsenal, agent segmentation, peer-voice WhatsApp sequences, the per-quote pricing model, Interakt template constraints, the activation flow, and the rule that the moat is data plus relationships, not technology. Consult before any sales, marketing-ops, or agent-growth work.
---

# TripStore — Agent Closing & GTM Playbook

This is the one that moves revenue. The tech mostly works; the business does not yet.

## THE HARD REALITY (lead with this when it's relevant)
- Live agents on the platform, **zero paying**. That gap, not any feature, is the bottleneck.
- Strategic guardrail: **the moat is data + agent relationships, NOT technology** (replicable in ~3 weeks). The founder is the bottleneck, not the product.
- Mistake #15: building features instead of closing agents. Before any "let's build X to convert agents," ask whether a conversation or a message would do it instead.
- Be brutally honest with Sumit. If a growth claim or plan is weak, say so.

## WHO WE SELL TO (ICP)
Independent Indian travel agents serving high-net-worth clients on European holidays. The warmest segment is **named agencies already doing Europe packages** (businesses, not random group members). They feel the quoting pain daily.

## THE PRODUCT PROMISE (USP arsenal — use verbatim where possible)
- **"Spend time closing, not quoting."** The core line.
- A detailed, multi-city, client-facing branded **PDF proposal in ~90 seconds** vs hours by hand.
- Built on **real trip data / 1,500+ real itineraries**, **75+ European cities**.
- Agent-branded output: their agency name, logo, contact details, no TripStore branding on the client PDF.
The demo IS the pitch: take a real route, hit Auto-Build, show the branded PDF appear in seconds.

## PRICING (how to talk about it)
- Per-quote model: ~₹99 first quote, cheaper/free on subsequent versions of the same quote. Wallet-based; ~₹495 credited on approval.
- Frame value against the agent's time, not the rupee amount: one closed HNI Europe booking dwarfs the quote cost. Lead with time saved + win-rate, mention price last.

## SEGMENT, DON'T SPRAY
- **Priority — named agencies:** personal-feeling, peer-voice first message; hit these first.
- **Cold — bulk/removed-batch numbers:** colder, lower-priority sequence; expect lower response.
- Tag the list. Dedupe (same prefix across two lines may be one person). The persistent agent-contact DB tool already built keeps the list growing across sessions and exports CSV for Interakt.

## MESSAGE PLAYBOOK (peer voice, not marketing voice)
- Sound like one agent telling another what works — blunt, specific, no hype.
- One clear ask per message. Short. WhatsApp-native.
- Default to the "Speed" and "Close Deals" angles (proven creatives). Provide 2–3 options; the blunt peer-voice option usually wins.
- Pair messages with the locked creatives (see `tripstore-creative`).

## INTERAKT / WHATSAPP TEMPLATE CONSTRAINTS
- Sending via Interakt. Three live templates: signup alert to Sumit, agent welcome on signup, agent activation on approval.
- **Meta rejects fancy templates** — the activation template only passed after stripping to a single-variable version. Keep templates simple, single-variable, low-promo. Draft for approval-survival, not cleverness.
- `quote_pdf` WhatsApp send must use `type:Template` + `headerValues:[pdfUrl]` (the `type:Document` form is a known bug to fix).

## ACTIVATION / ONBOARDING FLOW
- Approve flow: Sumit changes the role dropdown, then clicks Approve → fires ₹495 wallet credit + WhatsApp activation. (The `role==='PENDING'` guard previously blocked this — handle the manual-dropdown-first case.)
- Known pending: agent `beyonddestination` needs manual ₹495 wallet credit + WhatsApp activation.
- New agents may have no prior wallet row — credit via the direct path, not a balance-lookup that assumes an existing row.

## PARTNERSHIP PITCHES (e.g. National Tourism Offices)
- Angles that land: demand-signal data, secondary-city push, off-season dispersal, co-branded attribution. Skip "scaled trade education" — it weakens credibility at this stage.
- Anchor ask example used: ~₹10L/quarter.
- Flag aspirational stats honestly for Q&A (don't present 0-paying-agent reality as 200+ activated).

## WHAT NOT TO DO
- Don't build features to defend against theoretical problems (e.g. PDF-to-Word leak) while 0 agents pay.
- Don't spray the whole list with one generic blast.
- Don't over-promise in templates and get them rejected.
- Don't let a perfect asset block a same-day send — ship the message, iterate.
