# Real-Time Chat Application - Draft Plan (Current + Gap)

> Stack target: Next.js, Hono, Better Auth, Drizzle ORM, PostgreSQL, Redis, Cloudinary, WebSockets
> Snapshot date: May 11, 2026

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

- A Hono server exists with:
  - `GET /` health response
  - Better Auth handler at `POST|GET /api/auth/*`
- I have not implemented chat REST endpoints yet (`/api/conversations`, `/api/messages`, etc.).
- I have not implemented WebSocket upgrade/fan-out yet.

### Web reality (`apps/web`)

- Auth-oriented pages/components exist (login/signup/dashboard flow).
- Better Auth client wiring exists.
- I have not implemented a chat conversation list view, message thread view, composer, or realtime chat UI modules yet.

### Data/infra reality

- `packages/db` contains Drizzle setup and schema exports.
- The current Drizzle schema includes Better Auth core tables plus chat domain tables (`user_profile`, `conversation`, `participant`, `message`, `message_edit_history`, `message_status`, `message_reaction`).
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
  - Already-decrypted message JSON in cache (ciphertext never cached)
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
  - conversation <-> participant/message
  - message <-> reply/message_edit_history/message_status/message_reaction
  - user <-> participant/message/message_status/message_reaction
- Ordering and pagination source of truth:
  - `message.sequence_number` (not `created_at`) for chat ordering and cursor pagination.

### Schema Delta (Current vs Planned)

- The current Drizzle schema in repo includes Better Auth tables plus full chat domain tables.
- I still need to implement application behavior: API, realtime, and cache flows that operate on the schema.
- Therefore:
  - This DraftPlan schema is design-canonical and already mirrored in Drizzle.
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
- `POST /api/upload/sign`
- `DELETE /api/upload/image`

### Planned realtime events

- Client -> server: `join_conversation`, `send_message`, `typing_start`, `typing_stop`, `message_seen`
- Server -> client: `new_message`, `typing_update`, `message_status_update`, `member_added`, `member_removed`, `reaction_update`, `conversation_updated`

### Redis data model (from `docs/architecture/redis_data_model.svg`)

- Pub/sub channel per conversation: `conversation:{conversationId}` (payload includes `type`, `messageId`, `senderId`, `content`, `seqNumber`, `createdAt`).
- Typing keys: `typing:{conversationId}:{userId}` set to "1" with TTL 5s.
- Presence key: `presence:user:{userId}` as hash fields (`status`, `last_seen`) with TTL 30s refreshed by heartbeat.
- Message cache: ZSET `messages:{conversationId}` with score = `sequence_number` and value = already-decrypted message JSON.
- Cache behavior: `ZREVRANGE` last 50, trim to 50 entries, TTL 3600s.
- Cache stores plaintext JSON (decrypt once on DB read, never again on cache hits).

### Pagination + chat list rules (from `docs/architecture/pagination_and_chatlist.svg`)

- Pagination is cursor-based on `message.sequence_number`, not `created_at`.
- Query shape: `WHERE conversation_id = $id AND sequence_number < $cursor ORDER BY sequence_number DESC LIMIT 30`.
- Chat list ordering uses `conversation.last_message_id` (O(1) fetch) instead of per-conversation aggregation.
- `last_message_id` update must be in the same DB transaction as message insert.
- Client reorders chat list when `conversation_updated` event arrives.

---

## 6. Encryption and Cache Design

### Overview

I run AES-256-GCM encryption entirely on the server. The client always receives plaintext. Ciphertext (`content_enc`, `content_iv`) is an internal DB concern and never appears in API responses, WebSocket payloads, or Redis cache values.

Measured cost on Node.js with OpenSSL AES-NI hardware acceleration:

| Operation | Time per message | 3000 messages |
|---|---|---|
| `encrypt()` | ~0.006ms | ~18ms total |
| `decrypt()` | ~0.004ms | ~13ms total |
| DB round-trip (for comparison) | ~5-20ms | dominant cost |

Encryption contributes about 1% of total request time on a cache miss and 0% on a cache hit. The DB network hop is the real bottleneck, not crypto.

### Utility contract (`packages/db/src/crypto.ts`)

- `encrypt(plaintext: string): { content_enc: string, content_iv: string }`
  - Generates a fresh random 12-byte IV per message.
  - Appends the GCM auth tag to ciphertext so tampering is detectable on decrypt.
  - Returns both fields as base64 strings for DB storage.
- `decrypt({ content_enc, content_iv }): string`
  - Splits stored blob into ciphertext and auth tag.
  - Throws if auth tag validation fails (tamper detection).
- Key source: `ENCRYPTION_KEY` env var (64-char hex = 32-byte AES-256 key). I never return this to clients.

### `formatMessage()` boundary

All DB rows pass through a shared `formatMessage()` function before leaving `message.service.ts`. This function calls `decrypt()` and returns a plain `content` string. `content_enc` and `content_iv` never appear on any outbound object (HTTP responses, WS payloads, or Redis).

---

### Problem 1 - Decrypting the same messages over and over

Problem: At 1000 active users, 50 members of the same group each trigger a conversation open. Without caching, that is 50 separate DB queries returning the same 30 rows, followed by 50 x 30 = 1500 redundant decrypt calls, plus 50 DB network round-trips.

Solution: I cache already-decrypted JSON in Redis ZSET.

After the first DB read and decrypt, the formatted (plaintext) messages are written to `messages:{conversationId}` as a sorted set scored by `sequence_number`. Every subsequent open by any user hits Redis only (zero DB queries, zero decryption).

```
User 1 opens group  ->  cache miss  ->  DB query + decrypt 30  ->  Redis populated
Users 2-50 open     ->  cache hit   ->  ZREVRANGEBYSCORE -> JSON.parse only
```

Cache read path (first page, no cursor):

```ts
const cached = await redis.zrevrangebyscore(cacheKey, "+inf", "-inf", "LIMIT", 0, 30);
if (cached.length === 30) return cached.map((s) => JSON.parse(s)); // zero DB, zero decrypt
```

Cache miss path falls through to DB, decrypts, populates Redis via pipeline, returns.

Cursor-based older-page loads (scroll-up) bypass the cache and always go to DB, since the cache only holds the latest 50 messages.

---

### Problem 2 - New messages invalidating the cache correctly

Problem: After a new message is sent, the Redis ZSET for that conversation is stale. If not updated, users loading from cache will miss the latest message.

Solution: I append to the ZSET in the same pipeline as the send, trim to 50, refresh TTL.

After the DB transaction commits and `formatMessage()` produces the decrypted shape, a Redis pipeline runs:

```ts
pipeline.zadd(cacheKey, newMessage.sequenceNumber, JSON.stringify(newMessage));
pipeline.zremrangebyrank(cacheKey, 0, -51); // trim: keep only latest 50
pipeline.expire(cacheKey, 3600); // refresh TTL - active conv stays hot
await pipeline.exec(); // single Redis round-trip
```

Three commands, one round-trip. The ZSET now contains the new message. `ZREMRANGEBYRANK 0 -51` evicts the oldest entry only if the set exceeds 50, so the trim is a no-op on most sends.

The pipeline runs after the DB transaction commits. If Redis is unavailable, the message is already durably written to Postgres. Cache unavailability degrades to a DB read on the next open, not data loss.

---

### Problem 3 - Edit invalidation

Problem: When a sender edits a message, the cached ZSET entry for that message contains the old plaintext. Subsequent cache hits serve stale content.

Solution: I remove the old ZSET entry by score and re-add with updated content.

Because ZSET scores are `sequence_number` (unique per conversation), a targeted remove-and-re-add updates only the affected entry without touching the rest of the cache:

```ts
// Remove old entry - score range collapses to a single point (exact seq match)
await redis.zremrangebyscore(cacheKey, updatedMessage.sequenceNumber, updatedMessage.sequenceNumber);
// Add updated entry at the same score
await redis.zadd(cacheKey, updatedMessage.sequenceNumber, JSON.stringify(updatedMessage));
```

The updated `formatMessage()` output already has `is_edited: true` and `edited_at` set, so the cache entry is immediately correct for all subsequent reads.

Edit history (the old ciphertext) is written to `message_edit_history` inside the DB transaction before the cache update runs.

---

### Problem 4 - High write throughput (100 messages/second)

Problem: At 100 messages/second, each requiring a `SELECT FOR UPDATE` DB transaction for sequence number allocation, the concern is transaction queue depth and Postgres throughput.

Actual numbers: A single Postgres instance handles 1,000-5,000 simple transactions/second. 100/second is 2-10% of capacity. The `FOR UPDATE` lock is held for about 5-10ms. At this project's scale this is not a bottleneck.

However, if throughput genuinely becomes an issue, the mitigation is a write buffer that batches inserts per conversation:

```
Messages accumulate in memory buffer (per conversationId)
        |
Every 100ms: flush buffer per conversation in one transaction
        |
Allocate N sequence numbers in a single FOR UPDATE
        |
Bulk INSERT all N messages in one statement
```

This converts N transactions into 1 transaction per conversation per 100ms interval (a big reduction in lock contention). The tradeoff is up to 100ms additional latency before a message is persisted, which is acceptable for chat where WS push already delivers the message to recipients before the DB write completes (optimistic delivery).

For this project I implement the direct per-message transaction (simple, correct) and document the write buffer as a known scaling path. This shows the tradeoff without over-engineering.

---

### Signed Image Upload Flow

The server signs the upload parameters using `CLOUDINARY_API_SECRET`. The client uploads directly to Cloudinary (bypassing the server). The server secret never leaves the server boundary.

```
Client -> POST /api/upload/sign  (conversationId)
       <- { signature, timestamp, folder, apiKey, cloudName }

Client -> XHR POST to Cloudinary  (file + signed params)
       <- { secure_url, public_id, width, height, ... }

Client -> WS send_message  (type: "image", imageUrl: secure_url, content: public_id)

Server -> encrypt(public_id) -> INSERT message { content_enc, content_iv, image_url: secure_url }
```

Key points:
- `image_url` (Cloudinary CDN URL) is stored unencrypted because it is public by definition.
- `content` stores the `public_id`, which is encrypted. It contains internal path info required for deletion.
- `public_id` must be stored to support `DELETE /api/upload/image` (Cloudinary `uploader.destroy(publicId)`).
- The deletion endpoint verifies `sender_id = current user` before calling Cloudinary and soft-deleting the message row.
- I use XHR (not fetch) for upload so I can track upload progress via `xhr.upload.onprogress`.

---

## 7. Feature Status (Truthful)

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
- [ ] Image message flow (Cloudinary signed upload)
- [ ] Redis hot cache and pub/sub fan-out
- [ ] Encryption at rest for message content (AES-256-GCM)
- [ ] Cache invalidation on new message, edit, and delete

---

## 8. 7-Day Execution Plan (Adjusted to Current Baseline)

### Day 1 - Baseline Alignment + Schema Bring-Up

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

---

### Day 2 - Chat Core HTTP + Types

Backend todos:
- [ ] Implement `packages/db/src/crypto.ts` (`encrypt`, `decrypt`, benchmark)
- [ ] Implement `formatMessage()` boundary in `message.service.ts` (ciphertext never exits this function)
- [ ] Define shared Zod schemas for conversation and message inputs/outputs
- [ ] Add Hono routes for conversations and messages with `zValidator` and typed responses
- [ ] Implement sequence-number transaction strategy (`SELECT FOR UPDATE`) and atomic `last_message_id` update
- [ ] Add cursor-based pagination by `sequence_number` (limit 30)

Frontend todos:
- [ ] Create chat shell route (`/chat`) with empty states
- [ ] Add data hooks for conversation list + message list (typed fetchers)
- [ ] Add basic composer UI and send action wiring (no realtime yet)

Deliverable:
- End-to-end chat via HTTP (no realtime yet) with typed, validated APIs. Encryption verified by inspecting DB rows directly.

---

### Day 3 - Realtime + Redis Integration

Backend todos:
- [ ] WebSocket upgrade and connection lifecycle
- [ ] Redis pub/sub fan-out on `conversation:{conversationId}`
- [ ] Typing key TTL (5s) and presence heartbeat TTL (30s)
- [ ] Emit `conversation_updated` for chat list reordering
- [ ] Redis ZSET cache populate on first DB read (already-decrypted JSON, scored by `sequence_number`)
- [ ] Cache read path: `ZREVRANGEBYSCORE` before DB query on conversation open

Frontend todos:
- [ ] WebSocket client wiring and room join/leave
- [ ] Realtime updates for message list + typing indicators
- [ ] Reorder chat list on `conversation_updated`

Deliverable:
- Two clients receive live messages, typing updates, and chat list reordering. Cache hit verified via Redis CLI (`ZCARD messages:{id}` > 0 after open).

---

### Day 4 - Message Status + Chat List Fidelity

Backend todos:
- [ ] Delivered/seen persistence and broadcast
- [ ] Conversation list fetch by `last_message_id` with preview data
- [ ] Read-receipt behavior for DM and group contexts
- [ ] Cache append on new message send (Problem 2 solution: pipeline ZADD + ZREMRANGEBYRANK + EXPIRE)

Frontend todos:
- [ ] Status ticks and read receipts on messages
- [ ] Chat list preview (last message, time, unread count)

Deliverable:
- Reliable message lifecycle UX and correct chat list ordering. Cache stays fresh across sends.

---

### Day 5 - Groups, Roles, Reactions

Backend todos:
- [ ] Group role authorization gates
- [ ] Member add/remove + nickname updates
- [ ] Reaction mutation + realtime sync

Frontend todos:
- [ ] Group member management UI
- [ ] Reaction picker and reaction list display

Deliverable:
- Multi-user group workflow complete.

---

### Day 6 - Upload + Edit + Cache Hardening

Backend todos:
- [ ] Signed upload endpoint (`POST /api/upload/sign`) - SHA-1 signature, constrained params
- [ ] Image delete endpoint (`DELETE /api/upload/image`) - ownership check + Cloudinary destroy + soft-delete
- [ ] Image message send path: `type: "image"`, `image_url` unencrypted, `content` (public_id) encrypted
- [ ] Message edit path: write old ciphertext to `message_edit_history`, update message row, flip `is_edited`, set `edited_at`
- [ ] Cache invalidation on edit (Problem 3 solution: `ZREMRANGEBYSCORE` + `ZADD` at same score)
- [ ] Validate cache correctness: open group, send message, edit message, re-open (confirm cache reflects current state)

Frontend todos:
- [ ] Image message send (XHR with progress bar) and render (`<img>` with lightbox)
- [ ] Edit message UI: inline edit, "Edited" label under bubble
- [ ] Display `is_deleted` messages as "This message was deleted"

Deliverable:
- Media, edit, and cache invalidation all validated end-to-end.

---

### Day 7 - Hardening + Deploy Readiness

Backend todos:
- [ ] Error handling and rate-limit guardrails
- [ ] Deployment wiring (web -> Vercel, server + Postgres + Redis -> Railway)
- [ ] Verify WSS works on production (TLS proxy, correct `wss://` client URL)
- [ ] Run `infra:test` smoke test against production Redis + Postgres

Frontend todos:
- [ ] Error/empty/loading UX hardening
- [ ] Failed send retry state (red `!` indicator)
- [ ] Connection lost banner (WS disconnect detection)
- [ ] Documentation and demo polish (README, architecture diagrams, live link, demo GIF)

Deliverable:
- Submission-ready build. All rubric items covered and documented.

---

## 9. Frontend Functional Plan (Pages + Modules)

Routes (proposed):
- `/login` (existing): sign-in/sign-up UI
- `/chat`: chat shell with conversation list + thread view
- `/settings` (optional): profile edits, notification toggles

Core UI modules:
- Conversation list: preview, unread counts, last message, updated ordering on `conversation_updated`
- Thread view: message list with infinite scroll, typing indicator with avatar, status ticks
- Composer: text input, send button, file/image attachment, edit mode
- Header + user menu: profile/exit settings

Data + state:
- Server state: TanStack Query for conversation list + paginated messages via typed endpoints
- Client state: Zustand for message list + pagination cursor (`lowestSeq`, `hasMore`, `isLoadingMore`) + optimistic message buffer
- Realtime: WebSocket client for message + typing + status updates

UI states:
- Empty chat list, empty thread
- Loading and retry states for pagination and send
- Failed send state: red `!` with retry action
- Editing state: inline composer pre-filled with current message content
- Deleted message: greyed placeholder "This message was deleted"
- Image upload: progress bar during XHR, thumbnail preview after

---

## 10. Proposed Target Folder Expansion

Current `apps/server` has only entry-level wiring. The following structure is the implementation target:

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
    message.service.ts     <- encrypt/decrypt boundary lives here
    redis.service.ts       <- cache read/write/invalidate
    upload.service.ts      <- Cloudinary sign + delete

packages/db/src/
  crypto.ts                <- encrypt(), decrypt(), getKey()
  redis.ts                 <- getRedis(), getPub(), getSub(), RedisKeys, RedisTTL
  schema/
    auth.ts
    enums.ts
    profile.ts
    chat.ts
    relations.ts
    index.ts
```

---

## 11. Environment Variables

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
- `ENCRYPTION_KEY` - 64-char hex string (32 bytes). Generate: `openssl rand -hex 32`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

Web:
- Optional split URLs if needed later:
  - `NEXT_PUBLIC_API_URL`
  - `NEXT_PUBLIC_WS_URL`

---

## 12. Validation and Consistency Checks

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

# encryption boundary checks
rg -n "content_enc|content_iv" apps/server/src/routes
rg -n "formatMessage|decrypt" apps/server/src/services/message.service.ts

# cache correctness checks
rg -n "ZADD\|ZREMRANGE\|zremrangebyscore\|zadd" apps/server/src/services/redis.service.ts

# architecture alignment checks
rg -n "redis_data_model|pagination_and_chatlist|message_flow|system_overview" docs/DraftPlan.md
```

Encryption boundary rule: `content_enc` and `content_iv` must never appear outside `packages/db/src/crypto.ts` and `apps/server/src/services/message.service.ts`. If `rg -n "content_enc" apps/server/src/routes` returns any hits, that is a boundary violation.

---

## 13. Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Plan and code drift diverge again | Medium | Keep "Current vs Planned" split and update status markers each milestone |
| Realtime complexity blocks timeline | Medium | Stabilize HTTP + schema first, then layer WS/pub-sub |
| Sequence-order bugs under concurrency | Low | Transactional sequence allocation (`SELECT FOR UPDATE`) and DB unique constraint |
| Cache serving stale content after edit | Low | Problem 3 solution: `ZREMRANGEBYSCORE` + `ZADD` at same score on every edit |
| Cache serving stale content after send | Low | Problem 2 solution: pipeline `ZADD` + `ZREMRANGEBYRANK` + `EXPIRE` after every insert |
| Redis unavailable at runtime | Low | All cache paths fall through to DB silently (Redis is a performance layer, not a durability layer) |
| Cloudinary signed URL replayed by attacker | Low | Timestamp in signature expires within 60s; `allowed_formats` and `max_file_size` constrained in signature |
| Infra mismatch across local machines | Medium | Keep env-driven docker host-port config and document defaults |
| Write throughput exceeds DB capacity | Very Low at project scale | Direct per-message transaction is correct now; write buffer documented as known scaling path |
