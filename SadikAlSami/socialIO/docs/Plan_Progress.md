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

| Operation                      | Time per message | 3000 messages |
| ------------------------------ | ---------------- | ------------- |
| `encrypt()`                    | ~0.006ms         | ~18ms total   |
| `decrypt()`                    | ~0.004ms         | ~13ms total   |
| DB round-trip (for comparison) | ~5-20ms          | dominant cost |

Encryption contributes about 1% of total request time on a cache miss and 0% on a cache hit. The DB network hop is the real bottleneck, not crypto.

### Utility contract (`packages/db/src/lib/crypto.lib.ts`)

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
const cached = await redis.zrevrangebyscore(cacheKey, '+inf', '-inf', 'LIMIT', 0, 30);
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

### Day 2 — Schema Update + Profile + Search + Chat Core HTTP

Day2_Extension.md is now merged into this section and kept only as a reference.

#### A. Schema changes (do first — before any Day 2 code)

Three changes to the existing schema:

**1. Make `display_name` unique** (done)

```ts
// packages/db/src/schema/profile.ts
import { text, timestamp, pgTable, index } from 'drizzle-orm/pg-core';
import { user } from './auth';

export const userProfile = pgTable(
	'user_profile',
	{
		id: text('id')
			.primaryKey()
			.references(() => user.id, { onDelete: 'cascade' }),
		displayName: text('display_name').notNull().unique(),
		avatarUrl: text('avatar_url'),
		bio: text('bio'),
		lastSeenAt: timestamp('last_seen_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [index('user_profile_display_name_idx').on(table.displayName)],
	// The GIN trigram index lives in the custom migration file:
	// packages/db/src/migrations/0002_enable_pg_trgm.sql
);
```

**2. Add trigram extension to your migration** (done)

```sql
-- packages/db/src/migrations/0002_enable_pg_trgm.sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS profile_display_name_trgm_idx
  ON user_profile USING gin (display_name gin_trgm_ops);
```

**3. After schema change: generate + migrate + push** (done)

```bash
pnpm --filter @socialIO/db db:generate
pnpm --filter @socialIO/db db:migrate
pnpm --filter @socialIO/db db:push
```

#### B. Profile setup flow (no auto-create on signup)

Better Auth creates the `user` row on signup. Your app does **not** auto-create `user_profile`. After every login, the frontend checks whether a profile exists. If not, it redirects to `/profile/setup` before the user can access `/chat`.

This is the correct design because:

- Auto-creating an empty profile violates the `display_name NOT NULL` constraint
- Even if you allowed null display names, search would be broken for those users
- Forcing profile setup is the standard pattern (Discord, Notion, Linear all do this)

**Profile existence check**

```ts
// apps/server/src/routes/profile.ts
profileRouter.get('/me', isAuthenticated, async (c) => {
	const sessionUser = c.get('user')!;
	const userId = sessionUser.id;

	const [profile] = await db.select().from(userProfile).where(eq(userProfile.id, userId));

	if (!profile) {
		return c.json({ exists: false }, 404);
	}

	return c.json({ exists: true, profile });
});
```

**Profile setup route**

```ts
// apps/server/src/routes/profile.ts
const createProfileSchema = z.object({
	displayName: z
		.string()
		.min(3, 'Display name must be at least 3 characters')
		.max(32, 'Display name must be at most 32 characters')
		.regex(/^[a-zA-Z0-9_]+$/, 'Only letters, numbers, and underscores'),
	avatarUrl: z.url().optional(),
	bio: z.string().max(160).optional(),
});

profileRouter.post('/', isAuthenticated, validate('json', createProfileSchema), async (c) => {
	const sessionUser = c.get('user')!;
	const userId = sessionUser.id;
	const body = c.req.valid('json');

	const [existing] = await db.select({ id: userProfile.id }).from(userProfile).where(eq(userProfile.id, userId));

	if (existing) {
		return c.json({ error: 'Profile already exists' }, 409);
	}

	try {
		const [created] = await db
			.insert(userProfile)
			.values({
				id: userId,
				displayName: body.displayName,
				avatarUrl: body.avatarUrl ?? null,
				bio: body.bio ?? null,
			})
			.returning();

		return c.json(created, 201);
	} catch (err: any) {
		if (err.code === '23505') {
			return c.json({ error: 'Display name is already taken. Please choose another.' }, 409);
		}
		throw err;
	}
});
```

#### C. User search

Endpoint:

```
GET /api/profile/search?q={query}
```

- Requires auth (session cookie)
- Excludes the requesting user from results
- Searches `display_name` via trigram ILIKE
- Also searches `email` as a secondary path (prefix match)
- Returns max 20 results (people picker)
- Returns only `id`, `displayName`, `avatarUrl`

```ts
// apps/server/src/controllers/profile.controller.ts
const searchQuerySchema = z.object({
	q: z.string().min(2, 'Search query must be at least 2 characters').max(50),
});

profileController.get('/search', isAuthenticated, validate('query', searchQuerySchema), async (c) => {
	const sessionUser = c.get('user')!;
	const { q } = c.req.valid('query');

	const results = await searchUsers(q, sessionUser.id);
	return c.json(results);
});
```

#### D. Online/offline presence and last seen

Two separate concerns — do not conflate them:

| Concern                       | Storage                                  | Updated when                    | Used for                   |
| ----------------------------- | ---------------------------------------- | ------------------------------- | -------------------------- |
| **Online now** (green dot)    | Redis `presence:user:{id}` HASH, TTL 30s | WS connect, heartbeat every 20s | Live indicator in chat UI  |
| **Last seen** (e.g. "3h ago") | `user_profile.last_seen_at` timestamp    | WS disconnect                   | Shown when user is offline |

The REST presence endpoint is deferred; WS presence wiring is Day 3.

---

#### E. Day 2 todos — updated and complete

##### E0. Shared schemas + typed context (done)

- [x] Define shared Zod schemas for chat/user/profile in `packages/db/src/validators`
- [x] Implement API validators in `apps/server/src/validators`
- [x] Implement auth/error/validation middleware in `apps/server/src/middlewares`
- [x] Add typed context helpers in `apps/server/src/types/app-env.ts` and `apps/server/src/types/hono-env.ts`

##### E1. Schema (already done)

- [x] Add `unique()` to `userProfile.displayName` in `packages/db/src/schema/profile.ts`
- [x] Add trigram index `profile_display_name_trgm_idx` (GIN, `gin_trgm_ops`) in `packages/db/src/migrations/0002_enable_pg_trgm.sql`
- [x] Add `CREATE EXTENSION IF NOT EXISTS pg_trgm` to `packages/db/src/migrations/0002_enable_pg_trgm.sql`
- [x] Run `db:generate` → `db:migrate` → `db:push`
- [x] Verify in psql: `\d user_profile` shows UNIQUE on `display_name`, `\di` shows the GIN index

##### E2. Crypto

- [x] Implement `packages/db/src/lib/crypto.lib.ts` (`encrypt`, `decrypt`, `getKey`)
- [x] Run benchmark: `pnpm tsx packages/db/src/lib/crypto.test.ts` (from `apps/server` with `DOTENV_CONFIG_PATH=.env`)
- [x] Manually verify round-trip: `decrypt(encrypt("hello")) === "hello"`

##### E3. Profile service (`apps/server/src/services/profile.service.ts`)

- [x] `getProfile(userId)` — returns profile or null
- [x] `createProfile({ userId, displayName, avatarUrl?, bio? })` — inserts, handles 23505 uniqueness error
- [x] `updateProfile(userId, patch)` — partial update, handles 23505
- [x] `updateProfileImage(userId, data)` — update avatar, handles 23505

##### E4. User service (`apps/server/src/services/user.service.ts`)

- [x] `searchUsers(query, requestingUserId)` — trigram ILIKE on display_name + prefix on email, max 20
- [ ] `getUserPresence(userIds[])` — Redis pipeline EXISTS check, returns `Record<string, boolean>`

##### E5. Conversation service (`apps/server/src/services/conversation.service.ts`)

- [x] `findOrCreateDm(userAId, userBId)` — sort IDs, check existing, create if not found
- [x] `createGroup({ name, creatorId, participantIds[] })` — insert conversation + participants, creator gets role admin
- [x] `getUserConversations(userId)` — join with last_message + sender profile for preview
- [x] `getConversationById(id, requestingUserId)` — single conversation with participants, auth check

##### E6. Message service (`apps/server/src/services/message.service.ts`)

- [x] `formatMessage(row)` — decrypt boundary, never exposes content_enc/content_iv
- [x] `sendMessage({ conversationId, senderId, content, type, imageUrl?, replyToId? })` — encrypt, FOR UPDATE txn, last_message_id update
- [x] `getMessages({ conversationId, cursor?, limit? })` — cursor pagination by sequence_number DESC
- [x] `editMessage({ messageId, editorId, newContent })` — auth check, insert edit history, update message, cache invalidation
- [x] `deleteMessage({ messageId, requesterId })` — auth check, soft delete (set content to null, type to "deleted"), cache invalidation

##### E7. Controllers, routes, and middleware

- [x] Services in `apps/server/src/services` (profile, users, conversations, messages)
- [x] Controllers in `apps/server/src/controllers` (profile, users, conversations, messages) and mount in `apps/server/src/index.ts`
- [x] Auth middleware: `isAuthenticated` in `apps/server/src/middlewares/auth.middlewares.ts` (sets `user`/`session` in context)
- [x] Membership guard middleware: add `isMember` in `apps/server/src/middlewares` (403 if not a member)
- [x] Validation middleware: `validate` from `apps/server/src/middlewares/validation.middlewares.ts`

Routes to implement:

```
GET  /api/profile/me                   → getProfile, returns { exists, profile }
POST /api/profile                      → createProfile (setup page submit)
PATCH /api/profile                     → updateProfile (settings page)
PATCH /api/profile/avatar              → updateProfileImage

GET  /api/profile/search?q=            → searchProfiles (min 2 chars)
GET  /api/users/presence?ids=          → getUserPresence (deferred)

GET  /api/conversations                → getUserConversations
POST /api/conversations                → findOrCreateDm | createGroup
GET  /api/conversations/:id            → getConversationById (participant guard)

GET  /api/conversations/:id/messages   → getMessages (participant guard, cursor pagination)
POST /api/conversations/:id/messages   → sendMessage (participant guard, encrypt)
```

##### E8. Frontend

- [ ] After login: call `GET /api/profile/me` → redirect to `/profile/setup` if `exists: false`
- [ ] `/profile/setup` page: form prefilled with `user.name` and `user.image`, submit calls `POST /api/profile`, on success redirect to `/chat`
- [ ] `/chat` shell: conversation list sidebar + empty thread state
- [ ] "New Chat" button → search modal → `GET /api/profile/search?q=` (debounced 300ms) → click result → `POST /api/conversations` → navigate to conversation
- [ ] Conversation list: renders each item with avatar, display name, last message preview
- [ ] Thread view: renders messages from `GET /api/conversations/:id/messages`
- [ ] Composer: text input → `POST /api/conversations/:id/messages` → TanStack Query invalidates → thread re-renders

##### E9. Day 2 verification checklist

```bash
# Schema
psql → \d user_profile → display_name has UNIQUE constraint
psql → \di → profile_display_name_trgm_idx exists

# Crypto
pnpm tsx packages/db/src/lib/crypto.test.ts → sub-0.01ms per op

# Encryption boundary
rg -n "content_enc|content_iv" apps/server/src/routes  → zero hits
psql → SELECT content_enc FROM message LIMIT 1 → shows ciphertext, not plaintext

# Profile
curl POST /api/profile { displayName: "simanto" } → 201 created
curl POST /api/profile { displayName: "simanto" } again → 409 taken

# Search
curl GET /api/profile/search?q=si → results, no self in list
curl GET /api/profile/search?q=s  → 422 too short

# DM idempotency
curl POST /api/conversations { type: "dm", participantId: "X" } → conv id "abc"
curl POST /api/conversations { type: "dm", participantId: "X" } → same "abc"

# Messages
curl POST /api/conversations/abc/messages { content: "hello" } → 201, content: "hello"
psql → SELECT content_enc FROM message → ciphertext, not "hello"
curl GET /api/conversations/abc/messages → [{ content: "hello", sequenceNumber: 1 }]

# Auth
curl GET /api/conversations (no cookie) → 401
curl GET /api/conversations/abc/messages (not a participant) → 403
```

#### F. Presence notes for Day 3

Day 2 presence REST endpoint is deferred. Day 3 adds:

- `SET presence:user:{id}` on WS connect
- `EXPIRE` refresh on heartbeat (every 20s)
- `DEL presence:user:{id}` + `UPDATE user_profile SET last_seen_at` on WS disconnect
- `presence_update` WS broadcast to shared conversations on connect/disconnect

#### G. Gap verification (after merge)

| Area                              | Status                                        |
| --------------------------------- | --------------------------------------------- |
| Auth (signup/login)               | Covered — Better Auth handles this            |
| Profile setup gate                | Covered — Section B                           |
| Display name uniqueness + index   | Covered — Section A                           |
| User search                       | Covered — Section C                           |
| DM creation (find or create)      | Covered — Section E5                          |
| Group creation                    | Covered — Section E5                          |
| Live presence (green dot)         | Covered — Section D, wired in Day 3           |
| Last seen timestamp               | Covered — Section D, written on WS disconnect |
| Message send with encryption      | Covered — Section E6                          |
| Message pagination                | Covered — Section E6                          |
| Conversation list with preview    | Covered — Section E5                          |
| Redis cache (hot conversations)   | Covered — Day 3                               |
| Typing indicators                 | Covered — Day 3                               |
| Message status (delivered/seen)   | Covered — Day 4                               |
| Group roles + member management   | Covered — Day 5                               |
| Reactions                         | Covered — Day 5                               |
| Image upload                      | Covered — Day 6                               |
| Message edit + cache invalidation | Covered — Day 6                               |
| Deployment                        | Covered — Day 7                               |

---

### Day 3 - Realtime + Redis Integration

Backend todos:

- [ ] WebSocket upgrade and connection lifecycle
- [ ] Presence WS wiring depends on Day 2 presence REST endpoint and `last_seen_at`
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
  controllers/
    profile.controller.ts
    users.controller.ts
    conversations.controller.ts
    messages.controller.ts
  routes/
    profile.ts
    users.ts
    conversations.ts
    messages.ts
    members.ts
    reactions.ts
    upload.ts
  ws/
    handler.ts
    redis-pubsub.ts
  services/
    profile.service.ts
    user.service.ts
    conversation.service.ts
    message.service.ts     <- encrypt/decrypt boundary lives here
    redis.service.ts       <- cache read/write/invalidate
    upload.service.ts      <- Cloudinary sign + delete

packages/db/src/
  lib/crypto.lib.ts         <- encrypt(), decrypt(), getKey()
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

Encryption boundary rule: `content_enc` and `content_iv` must never appear outside `packages/db/src/lib/crypto.lib.ts` and `apps/server/src/services/message.service.ts`. If `rg -n "content_enc" apps/server/src/routes` returns any hits, that is a boundary violation.

---

## 13. Risks and Mitigations

| Risk                                       | Likelihood                | Mitigation                                                                                                |
| ------------------------------------------ | ------------------------- | --------------------------------------------------------------------------------------------------------- |
| Plan and code drift diverge again          | Medium                    | Keep "Current vs Planned" split and update status markers each milestone                                  |
| Realtime complexity blocks timeline        | Medium                    | Stabilize HTTP + schema first, then layer WS/pub-sub                                                      |
| Sequence-order bugs under concurrency      | Low                       | Transactional sequence allocation (`SELECT FOR UPDATE`) and DB unique constraint                          |
| Cache serving stale content after edit     | Low                       | Problem 3 solution: `ZREMRANGEBYSCORE` + `ZADD` at same score on every edit                               |
| Cache serving stale content after send     | Low                       | Problem 2 solution: pipeline `ZADD` + `ZREMRANGEBYRANK` + `EXPIRE` after every insert                     |
| Redis unavailable at runtime               | Low                       | All cache paths fall through to DB silently (Redis is a performance layer, not a durability layer)        |
| Cloudinary signed URL replayed by attacker | Low                       | Timestamp in signature expires within 60s; `allowed_formats` and `max_file_size` constrained in signature |
| Infra mismatch across local machines       | Medium                    | Keep env-driven docker host-port config and document defaults                                             |
| Write throughput exceeds DB capacity       | Very Low at project scale | Direct per-message transaction is correct now; write buffer documented as known scaling path              |
