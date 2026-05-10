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
- Current Drizzle schema includes Better Auth core tables plus chat domain tables (`user_profile`, `conversation`, `participant`, `message`, `message_edit_history`, `message_status`, `message_reaction`).
- Enums for chat domain are defined in Drizzle (`conversation_type`, `participant_role`, `message_type`, `message_delivery_status`).
- Local Docker infra exists in `packages/db/docker-compose.yml` for Postgres + Redis.
- Turborepo scripts for infra/database tasks are wired (`db:*`, `infra:*`, `redis:*`).

---

## 3. Target Architecture (Planned)

This is the intended architecture, not current implementation status.

- `apps/server` should become an API gateway + realtime node:
  - Auth routes (already present)
  - Chat REST routes for conversations, messages, members, reactions, upload
  - WebSocket handling for room join, message fan-out, typing, status updates
  - End-to-end request/response validation with Zod + Hono `zValidator`
  - Shared schemas for end-to-end typesafety (server and web)
- `apps/web` should become a chat client:
  - Conversation list + detail thread UI
  - Message composer + reactions + status indicators
  - Realtime channel client integration
- Redis should provide:
  - Pub/sub for multi-instance fan-out
  - Ephemeral typing keys with TTL
  - Presence with periodic heartbeat TTL
  - Hot-conversation cache (ZSET by sequence number)
- PostgreSQL should provide durable chat state with sequence-based ordering and transactional `last_message_id` updates.

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

- Current implemented Drizzle schema in repo: Better Auth tables plus full chat domain tables.
- Planned but not yet implemented in application code: API, realtime, and cache flows that operate on the schema.
- Therefore:
  - DraftPlan schema is design-canonical and already mirrored in Drizzle.
  - Application behavior still needs to catch up.

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
- Server -> client: `new_message`, `typing_update`, `message_status_update`, `member_added`, `member_removed`, `reaction_update`, `conversation_updated`

### Redis data model (from `docs/architecture/redis_data_model.svg`)

- Pub/sub channel per conversation: `conversation:{conversationId}` (payload includes `type`, `messageId`, `senderId`, `content`, `seqNumber`, `createdAt`).
- Typing keys: `typing:{conversationId}:{userId}` set to "1" with TTL 5s.
- Presence key: `presence:user:{userId}` as hash fields (`status`, `last_seen`) with TTL 30s refreshed by heartbeat.
- Message cache: ZSET `messages:{conversationId}` with score = `sequence_number` and value = message JSON.
- Cache behavior: `ZREVRANGE` last 50, trim to 50 entries, TTL 3600s.

### Pagination + chat list rules (from `docs/architecture/pagination_and_chatlist.svg`)

- Pagination is cursor-based on `message.sequence_number`, not `created_at`.
- Query shape: `WHERE conversation_id = $id AND sequence_number < $cursor ORDER BY sequence_number DESC LIMIT 30`.
- Chat list ordering uses `conversation.last_message_id` (O(1) fetch) instead of per-conversation aggregation.
- `last_message_id` update must be in the same DB transaction as message insert.
- Client reorders chat list when `conversation_updated` event arrives.

---

## 6. Feature Status (Truthful)

### Foundation

- [x] Monorepo scaffold (`apps/*`, `packages/*`)
- [x] Better Auth baseline integration
- [x] Basic Hono server bootstrapped
- [x] Local Postgres + Redis infra setup in `packages/db`
- [x] Chat domain Drizzle schema implementation
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
- [x] Implement full chat/domain schema in Drizzle from canonical SQL design
- [x] Generate/push migrations for new tables and indexes
- [x] Add schema-level enums/validation contracts for role/type/status fields

Deliverable:
- Drizzle schema matches canonical chat design.

### Day 2 — Chat Core HTTP + Types

Backend todos:
- [ ] Define shared Zod schemas for conversation and message inputs/outputs
- [ ] Add Hono routes for conversations and messages with `zValidator` and typed responses
- [ ] Implement sequence-number transaction strategy and atomic `last_message_id` update
- [ ] Add cursor-based pagination by `sequence_number` (limit 30)

Frontend todos:
- [ ] Create chat shell route (`/dashboard` or `/chat`) with empty states
- [ ] Add data hooks for conversation list + message list (typed fetchers)
- [ ] Add basic composer UI and send action wiring (no realtime yet)

Deliverable:
- End-to-end chat via HTTP (no realtime yet) with typed, validated APIs.

### Day 3 — Realtime + Redis Integration

Backend todos:
- [ ] WebSocket upgrade and connection lifecycle
- [ ] Redis pub/sub fan-out on `conversation:{conversationId}`
- [ ] Typing key TTL (5s) and presence heartbeat TTL (30s)
- [ ] Emit `conversation_updated` for chat list reordering

Frontend todos:
- [ ] WebSocket client wiring and room join/leave
- [ ] Realtime updates for message list + typing indicators
- [ ] Reorder chat list on `conversation_updated`

Deliverable:
- Two clients receive live messages, typing updates, and chat list reordering.

### Day 4 — Message Status + Chat List Fidelity

Backend todos:
- [ ] Delivered/seen persistence and broadcast
- [ ] Conversation list fetch by `last_message_id` with preview data
- [ ] Read-receipt behavior for DM and group contexts

Frontend todos:
- [ ] Status ticks and read receipts on messages
- [ ] Chat list preview (last message, time, unread count)

Deliverable:
- Reliable message lifecycle UX and correct chat list ordering.

### Day 5 — Groups, Roles, Reactions

Backend todos:
- [ ] Group role authorization gates
- [ ] Member add/remove + nickname updates
- [ ] Reaction mutation + realtime sync

Frontend todos:
- [ ] Group member management UI
- [ ] Reaction picker and reaction list display

Deliverable:
- Multi-user group workflow complete.

### Day 6 — Upload + Encryption + Cache

Backend todos:
- [ ] Signed upload flow and image messages
- [ ] Message encryption/decryption service paths (AES-256-GCM)
- [ ] Redis ZSET cache populate/read/trim behavior (max 50, TTL 3600s)
- [ ] Read-through cache on conversation open (cache hit or DB + populate)

Frontend todos:
- [ ] Image message send and preview
- [ ] Display encrypted text as decrypted content only

Deliverable:
- Media + encrypted persistence + cache behavior validated.

### Day 7 — Hardening + Deploy Readiness

Backend todos:
- [ ] Error handling and rate-limit guardrails
- [ ] Deployment wiring (web + server + data services)

Frontend todos:
- [ ] Error/empty/loading UX hardening
- [ ] Documentation and demo polish

Deliverable:
- Submission-ready build candidate.

---

## 8. Frontend Functional Plan (Pages + Modules)

Routes (proposed)
- `/login` (existing): sign-in/sign-up UI
- `/dashboard` or `/chat`: chat shell with conversation list + thread view
- `/settings` (optional): profile edits, notification toggles

Core UI modules
- Conversation list: preview, unread counts, last message, updated ordering on `conversation_updated`
- Thread view: message list with infinite scroll, typing indicator, status ticks
- Composer: text input, send button, file/image attachment
- Header + user menu: profile/exit settings

Data + state
- Server state: fetch conversations and paginated messages via typed endpoints
- Client state: local UI state for composer, modal, and scroll anchors
- Optional: Zustand for message list + pagination cursor (`lowestSeq`, `hasMore`, `isLoadingMore`)
- Realtime: WebSocket client for message + typing + status updates

UI states
- Empty chat list, empty thread
- Loading and retry states for pagination and send
- Error state on failed send, fallback to retry

---

## 9. Proposed Target Folder Expansion (Not Yet Present)

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

## 10. Environment Variables

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

## 11. Validation and Consistency Checks

Use these checks after DraftPlan updates and during implementation:

```bash
# stale path checks
rg -n "/apps/api|apps/api" docs/DraftPlan.md

# schema design source checks
rg -n "user_profile|conversation|participant|message_edit_history|message_status|message_reaction" docs/database/database-design.sql

# current implementation reality checks
rg -n "app\.on\(\[\"POST\", \"GET\"\], \"/api/auth/\*\"" apps/server/src/index.ts
rg -n "export const (conversation|participant|message|messageEditHistory|messageStatus|messageReaction)" packages/db/src/schema/chat.ts
rg -n "conversation_type|participant_role|message_type|message_delivery_status" packages/db/src/schema/enums.ts

# architecture alignment checks
rg -n "redis_data_model|pagination_and_chatlist|message_flow|system_overview" docs/DraftPlan.md
```

---

## 12. Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Plan and code drift diverge again | Medium | Keep "Current vs Planned" split and update status markers each milestone |
| Realtime complexity blocks timeline | Medium | Stabilize HTTP + schema first, then layer WS/pub-sub |
| Sequence-order bugs under concurrency | Low | Transactional sequence allocation and DB constraints |
| Infra mismatch across local machines | Medium | Keep env-driven docker host-port config and document defaults |