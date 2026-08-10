# Echo

Echo is an observability copilot for HighLevel Voice AI agents. It helps teams
understand whether calls are healthy, whether an agent followed its goals, and
what should improve next.

## Who it is for

- **Operations and QA teams** reviewing many calls without reading every
  transcript manually.
- **Conversation designers** checking whether an agent follows its intended
  script or business goal.
- **Team leads** turning repeated call failures into concrete coaching or prompt
  changes.

## The main loop

```text
Define agent goals
        |
        v
Collect completed calls
        |
        v
Analyze baseline quality + configured criteria
        |
        v
Review evidence and human actions
        |
        v
Improve the script or prompt
        |
        +-------------------- repeat --------------------+
```

Baseline monitoring is available for every call. Pass/fail verdicts and review
flags appear only after someone configures criteria for that agent.

## Backend flows

Realtime calls:

```text
HighLevel webhook
            |
            v
Validate and normalize call data
            |
            v
Store call, transcript, and agent context
            |
            v
Compute baseline metrics
            |
            v
Evaluate configured criteria (when present)
            |
            v
Aggregate results for the dashboard and review queue
```

Historical calls:

```text
HighLevel call history
          |
          v
Backfill and normalize missing calls
          |
          v
Store call, transcript, and agent context
          |
          v
Compute baseline metrics
          |
          v
Evaluate configured criteria (when present)
          |
          v
Aggregate results for dashboards and historical review
```

## Core features

| Feature | What it does |
|---------|--------------|
| Call ingestion | Collects completed Voice AI calls from HighLevel webhooks and call-log backfill. |
| Baseline monitoring | Shows completion, sentiment, talk share, turns, interruptions, and other call signals. |
| Agent settings | Lets a user define manual pass/fail criteria in one compact row-and-modal workflow per agent. |
| Evidence-linked evaluation | Shows each criterion result, rationale, score, and supporting transcript turns. |
| Review actions | Highlights call segments for follow-up, training, or compliance review; actions can be resolved or dismissed. |
| Recommendations | Groups recurring failures and suggests prompt or script changes linked to evidence calls. |

## Install in HighLevel

1. Open the [Echo HighLevel install link](https://marketplace.gohighlevel.com/v2/oauth/chooselocation?response_type=code&redirect_uri=https%3A%2F%2Fecho.52-66-252-246.sslip.io%2Fauth%2Foauth%2Fcallback&client_id=6a6f24bb03ccacf3eff3b462-msbpkoyp&scope=conversations.readonly+conversations%2Fmessage.readonly+reports.readonly+agent-studio.readonly+conversation-ai.readonly+voice-ai-dashboard.readonly+voice-ai-agents.readonly+voice-ai-agent-goals.readonly&version_id=6a6f24bb03ccacf3eff3b462) and choose the location where Echo should be installed.
2. Authorize the location. Echo then syncs the Voice AI agents and begins collecting calls.

## Tech stack

| Layer | Technology |
|-------|------------|
| Frontend | Vue 3, Vite, Tailwind CSS, TanStack Query |
| Backend | Node.js, Fastify, Drizzle, Inngest, Zod |
| AI | Structured LLM evaluation and recommendation generation |
| Data | PostgreSQL via Supabase |

## Future features

- Expanded metrics and more customizable quality signals.
- Pre-computation tables for faster dashboard aggregation; intentionally not
  included in this MVP.
- Optional prompt write-back after a user reviews and approves a recommendation.
