# TODOS

These are planned items, not active work. Create a `COOP-*` GitHub Issue before implementation.

## Calendar sources

### COOP-001 — Plan Microsoft Teams assignment imports

**Status:** Proposed
**Priority:** P2

**What:** Design read-only assignment and deadline import after the calendar repair.

**Why:** Bring school commitments into Cooper's priority list and day view.

**Context:** Requested by the user; deferred in the approved September 10 repair.
Inspect school-account consent and the existing sources/writer boundaries before
implementation. Imported deadlines must stay separate from scheduled work sessions.
This is planning work, not authorization to request broader OAuth scopes.

**Pros:** Reduces missing school commitments and manual entry.
**Cons:** Requires provider setup, permissions, reconciliation, and live acceptance.
**Effort:** L human / M agent-assisted; account setup remains external.
**Priority:** P2
**Depends on:** Calendar core repair and verified source-health contract.

### COOP-002 — Plan Google Classroom assignment imports

**Status:** Proposed
**Priority:** P2

**What:** Design read-only assignments, due dates, and update reconciliation.

**Why:** Include coursework alongside personal tasks without copying deadlines by hand.

**Context:** Requested by the user; separate from Google Calendar event reads.
Confirm supported account access and required consent with official documentation
before building. Do not display a working connection until live acceptance passes.

**Pros:** Gives coursework one destination with existing tasks.
**Cons:** Adds permission/setup requirements and provider-specific reconciliation.
**Effort:** L human / M agent-assisted; account setup remains external.
**Priority:** P2
**Depends on:** Calendar core repair and verified source-health contract.
