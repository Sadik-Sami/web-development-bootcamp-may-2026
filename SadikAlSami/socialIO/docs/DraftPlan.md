# Real-Time Chat Application — Draft Plan (Current + Gap)

> Stack target: Next.js · Hono · Better Auth · Drizzle ORM · PostgreSQL · Redis · Cloudinary · WebSockets  
> Snapshot date: May 10, 2026

---

## 1. Purpose of this Draft

This document is an execution plan that separates:

1. what is already present in the repository today, and
2. what still needs to be implemented for the full chat system.

It is not a "done report." It is a truthful build roadmap.

---

## 2. Current Repository Architecture (Observed)

### Monorepo shape

- `apps/web`
- `apps/server`
- `packages/auth`
- `packages/db`
- `packages/env`
- `packages/ui`
- `packages/config`

### Server reality (`apps/server`)

- Hono server exists with:
  - `GET /` health response
  - Better Auth handler at `POST|GET /api/auth/*`
- No chat REST endpoints are implemented yet (`/api/conversations`, `/api/messages`, etc.).
- No WebSocket upgrade/fan-out implementation exists yet in code.

### Web reality (`apps/web`)

- Auth-oriented pages/components exist (login/signup/dashboard flow).
- Better Auth client wiring exists.
- No chat conversation list view, message thread view, composer, or realtime chat UI modules are implemented yet.

### Data/infra reality

- `packages/db` contains Drizzle setup and schema exports.
- Current Drizzle schema in code is Better Auth core tables only (`packages/db/src/schema/auth.ts`).
- Local Docker infra exists in `packages/db/docker-compose.yml` for Postgres + Redis.
- Turborepo scripts for infra/database tasks are wired (`db:*`, `infra:*`, `redis:*`).

---

## 3. Target Architecture (Planned)

This is the intended architecture, not current implementation status.

- `apps/server` should become an API gateway + realtime node:
  - Auth routes (already present)
  - Chat REST routes for conversations, messages, members, reactions, upload
  - WebSocket handling for room join, message fan-out, typing, status updates
- `apps/web` should become a chat client:
  - Conversation list + detail thread UI
  - Message composer + reactions + status indicators
  - Realtime channel client integration
- Redis should provide:
  - pub/sub for multi-instance fan-out
  - ephemeral typing/presence keys
  - hot-conversation cache (ZSET by sequence number)
- PostgreSQL should provide durable chat state with sequence-based ordering.

---

## 4. Database Design (Canonical: `database-design.sql`)

The canonical schema source for planning is:

- `docs/database/database-design.sql`
- `docs/database/database-design.svg` and `docs/database/database-design.png` are visual companions.

### Auth core tables

- `user`
- `session`
- `account`
- `verification`

### Chat/domain tables

- `user_profile`
- `conversation`
- `participant`
- `message`
- `message_edit_history`
- `message_status`
- `message_reaction`

### Critical constraints and indexing rules

- `participant(conversation_id, user_id)` unique.
- `message(conversation_id, sequence_number)` unique.
- `message_status(message_id, user_id)` composite primary key.
- `message_reaction(message_id, user_id, emoji)` unique.
- Foreign keys connect:
  - conversation ↔ participant/message
  - message ↔ reply/message_edit_history/message_status/message_reaction
  - user ↔ participant/message/message_status/message_reaction
- Ordering and pagination source of truth:
  - `message.sequence_number` (not `created_at`) for chat ordering and cursor pagination.

### Schema Delta (Current vs Planned)

- Current implemented Drizzle schema in repo: Better Auth tables only.
- Planned but not yet implemented in Drizzle: `user_profile`, `conversation`, `participant`, `message`, `message_edit_history`, `message_status`, `message_reaction`.
- Therefore:
  - DraftPlan schema is design-canonical.
  - Application code is still partial and must catch up.

---

## 5. API and Realtime Surfaces (Status)

### Current

- `POST|GET /api/auth/*` implemented via Better Auth.
- `GET /` implemented.

### Planned REST endpoints

- `GET /api/conversations`
- `POST /api/conversations`
- `GET /api/conversations/:id`
- `PATCH /api/conversations/:id`
- `GET /api/conversations/:id/messages`
- `DELETE /api/messages/:id`
- `POST /api/conversations/:id/members`
- `DELETE /api/conversations/:id/members/:userId`
- `PATCH /api/conversations/:id/members/me`
- `POST /api/messages/:id/reactions`
- `DELETE /api/messages/:id/reactions/:emoji`
- `POST /api/upload`

### Planned realtime events

- Client -> server: `join_conversation`, `send_message`, `typing_start`, `typing_stop`, `message_seen`
- Server -> client: `new_message`, `typing_update`, `message_status_update`, `member_added`, `member_removed`, `reaction_update`

---

## 6. Feature Status (Truthful)

### Foundation

- [x] Monorepo scaffold (`apps/*`, `packages/*`)
- [x] Better Auth baseline integration
- [x] Basic Hono server bootstrapped
- [x] Local Postgres + Redis infra setup in `packages/db`
- [ ] Chat domain Drizzle schema implementation
- [ ] Chat HTTP APIs
- [ ] Realtime WebSocket flow

### Product features

- [ ] DM and group conversation creation
- [ ] Cursor-based message pagination
- [ ] Typing indicators
- [ ] Message delivered/seen lifecycle
- [ ] Group membership admin flows
- [ ] Emoji reactions
- [ ] Image message flow (Cloudinary)
- [ ] Redis hot cache and pub/sub fan-out
- [ ] Encryption at rest for message content

---

## 7. 7-Day Execution Plan (Adjusted to Current Baseline)

### Day 1 — Baseline Alignment + Schema Bring-Up

Status:
- [x] Monorepo scaffold exists
- [x] Better Auth baseline exists
- [x] Postgres + Redis local infra exists

Remaining:
- [ ] Implement full chat/domain schema in Drizzle from canonical SQL design
- [ ] Generate/push migrations for new tables and indexes
- [ ] Add schema-level enums/validation contracts for role/type/status fields

Deliverable:
- Drizzle schema matches canonical chat design.

### Day 2 — Chat Core HTTP

- [ ] Conversation CRUD baseline endpoints
- [ ] Message write/read endpoints
- [ ] Sequence-number transaction strategy for ordering
- [ ] Cursor-based pagination wiring

Deliverable:
- End-to-end chat via HTTP (no realtime yet).

### Day 3 — Realtime + Redis Integration

- [ ] WebSocket upgrade and connection lifecycle
- [ ] Redis pub/sub fan-out
- [ ] Typing/presence ephemeral key handling

Deliverable:
- Two clients receive live messages and typing updates.

### Day 4 — Message Status + Chat List Fidelity

- [ ] Delivered/seen persistence and broadcast
- [ ] Conversation list freshness from `last_message_id`
- [ ] Read-receipt behavior for DM and group contexts

Deliverable:
- Reliable message lifecycle UX.

### Day 5 — Groups, Roles, Reactions

- [ ] Group role authorization gates
- [ ] Member add/remove + nickname updates
- [ ] Reaction mutation + realtime sync

Deliverable:
- Multi-user group workflow complete.

### Day 6 — Upload + Encryption + Cache

- [ ] Signed upload flow and image messages
- [ ] Message encryption/decryption service paths
- [ ] Redis ZSET cache populate/read/trim behavior

Deliverable:
- Media + encrypted persistence + cache behavior validated.

### Day 7 — Hardening + Deploy Readiness

- [ ] Error/empty/loading UX hardening
- [ ] Deployment wiring (web + server + data services)
- [ ] Documentation and demo polish

Deliverable:
- Submission-ready build candidate.

---

## 8. Proposed Target Folder Expansion (Not Yet Present)

Current `apps/server` has only entry-level wiring. The following structure is proposed as implementation target:

```txt
apps/server/src/
  index.ts
  routes/
    conversations.ts
    messages.ts
    members.ts
    reactions.ts
    upload.ts
  ws/
    handler.ts
    redis-pubsub.ts
  services/
    message.service.ts
    redis.service.ts
    upload.service.ts
```

---

## 9. Environment Variables

### Current baseline (observed)

Server:

- `DATABASE_URL`
- `REDIS_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `CORS_ORIGIN`

Web:

- `NEXT_PUBLIC_SERVER_URL`

### Planned additions for chat features

Server:

- `ENCRYPTION_KEY`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

Web:

- Optional split URLs if needed later:
  - `NEXT_PUBLIC_API_URL`
  - `NEXT_PUBLIC_WS_URL`

---

## 10. Validation and Consistency Checks

Use these checks after DraftPlan updates and during implementation:

```bash
# stale path checks
rg -n "/apps/api|apps/api" docs/DraftPlan.md

# schema design source checks
rg -n "user_profile|conversation|participant|message_edit_history|message_status|message_reaction" docs/database/database-design.sql

# current implementation reality checks
rg -n "app\\.on\\(\\[\"POST\", \"GET\"\\], \"/api/auth/\\*\"" apps/server/src/index.ts
rg -n "export const (user|session|account|verification)" packages/db/src/schema/auth.ts
```

Expected interpretation:

- No stale `/apps/api` references in DraftPlan.
- Canonical table inventory present in SQL.
- Current server routes and current Drizzle scope are represented truthfully in the plan.

---

## 11. Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Plan and code drift diverge again | Medium | Keep "Current vs Planned" split and update status markers each milestone |
| Realtime complexity blocks timeline | Medium | Stabilize HTTP + schema first, then layer WS/pub-sub |
| Sequence-order bugs under concurrency | Low | Transactional sequence allocation and DB constraints |
| Infra mismatch across local machines | Medium | Keep env-driven docker host-port config and document defaults |
