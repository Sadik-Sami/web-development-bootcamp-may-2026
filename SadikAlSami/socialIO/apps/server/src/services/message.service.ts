import type { MessageSelect } from '@socialIO/db/validators/chat.validators';
import { decrypt, encrypt } from '@socialIO/db/lib';
import { nanoid } from 'nanoid';
import {
	messageResponseSchema,
	type MessageResponse,
	type CreateMessageBody,
	type EditMessageBody,
} from '@/validators';
import { db } from '@socialIO/db';
import { conversation, message, messageEditHistory } from '@socialIO/db/schema';
import { and, desc, eq, lt, max } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { redis, RedisKeys, RedisTTL } from '@socialIO/db/redis';

// Helper function to format message data for API responses
// converts MessageSelect rows to MessageResponse by decrypting content and renaming fields as needed
function formatMessage(row: MessageSelect & { senderDisplayName?: string | null }): MessageResponse {
	return messageResponseSchema.parse({
		...row,
		content: row.isDeleted ? null : decrypt({ content_enc: row.contentEnc, content_iv: row.contentIv }),
	});
}

export async function sendMessage(
	conversationId: string,
	senderId: string,
	body: CreateMessageBody,
): Promise<MessageResponse> {
	const { content, type = 'text', imageUrl, replyToId } = body;

	// 1. Encrypt the message content before storing it in the database
	const { content_enc, content_iv } = encrypt(content);

	// 2. validate replyToId belongs to this conversation
	if (replyToId) {
		const [replyTarget] = await db
			.select({ id: message.id })
			.from(message)
			.where(and(eq(message.id, replyToId), eq(message.conversationId, conversationId)))
			.limit(1);

		if (!replyTarget) {
			throw new HTTPException(400, { message: 'Invalid replyToId: message does not exist in this conversation' });
		}
	}

	// 3. Transaction: allocate sequence number ,insert the new message, update last_message_id
	const saved = await db.transaction(async (tx) => {
		// Lock the conversation row to prevent concurrent inserts from causing sequence number conflicts

		// 3.1 Fetch the conversation with a "FOR UPDATE" lock to prevent concurrent modifications
		const [conv] = await tx
			.select({ id: conversation.id })
			.from(conversation)
			.where(eq(conversation.id, conversationId))
			.for('update');

		if (!conv) {
			throw new HTTPException(404, { message: 'Conversation not found' });
		}

		// 3.2 Allocate the next sequence number for the new message
		const maxSeqResult = await tx
			.select({ maxSeq: max(message.sequenceNumber) })
			.from(message)
			.where(eq(message.conversationId, conversationId));

		const nextSeq = (maxSeqResult[0]?.maxSeq ?? 0) + 1;

		// 3.3 Insert the new message(Cyphered Text) with the allocated sequence number
		const insertResult = await tx
			.insert(message)
			.values({
				id: nanoid(),
				conversationId,
				senderId,
				sequenceNumber: nextSeq,
				contentEnc: content_enc,
				contentIv: content_iv,
				type,
				imageUrl: imageUrl ?? null,
				replyToId: replyToId ?? null,
			})
			.returning();

		const row = insertResult[0];
		if (!row) {
			throw new HTTPException(500, { message: 'Failed to send message' });
		}

		// 3.4 Update the conversation's last_message_id and updated_at timestamp
		await tx
			.update(conversation)
			.set({ lastMessageId: row.id, updatedAt: new Date() })
			.where(eq(conversation.id, conversationId));
		return row;
	});
	// Transaction Commited

	// 4. Decrypt once to build the public shape
	const formatted = formatMessage(saved);

	// 5. Populate Redis cache with plaintext JSON
	// Pipeline: one round trip for all three redis operations
	const cacheKey = RedisKeys.messageCache(conversationId);
	const pipeline = redis.pipeline();
	pipeline.zadd(cacheKey, formatted.sequenceNumber, JSON.stringify(formatted));
	pipeline.zremrangebyrank(cacheKey, 0, -51);
	pipeline.expire(cacheKey, RedisTTL.messageCache);
	await pipeline.exec();

	return formatted;
}

export async function getMessages(conversationId: string, cursor?: number, limit = 50): Promise<MessageResponse[]> {
	const cacheKey = RedisKeys.messageCache(conversationId);

	if (!cursor) {
		try {
			const cached = await redis.zrevrangebyscore(cacheKey, '+inf', '-inf', 'LIMIT', 0, limit);
			if (cached.length === limit) {
				return cached.map((s) => JSON.parse(s) as MessageResponse);
			}
		} catch {
			// Cache miss or Redis error, fallback to DB query
			// (We can log the error here if needed, but we don't want to fail the request just because of cache issues)
		}
	}
	const rows = await db
		.select()
		.from(message)
		.where(and(eq(message.conversationId, conversationId), cursor ? lt(message.sequenceNumber, cursor) : undefined))
		.orderBy(desc(message.sequenceNumber))
		.limit(limit);

	const formatted = rows.map(formatMessage);

	// Populating Redis cache for first page load (when cursor is not provided) to optimize subsequent requests
	if (!cursor && formatted.length > 0) {
		const pipeline = redis.pipeline();

		// Using zadd with sequenceNumber as score to maintain the order of messages in the cache
		// Using zremrangebyrank to trim the cache to the most recent 50 messages
		formatted.forEach((msg) => {
			pipeline.zadd(cacheKey, msg.sequenceNumber, JSON.stringify(msg));
		});
		pipeline.zremrangebyrank(cacheKey, 0, -(limit + 1));
		pipeline.expire(cacheKey, RedisTTL.messageCache);

		await pipeline.exec();
	}
	return formatted;
}

export async function editMessage(
	messageId: string,
	senderId: string,
	messageBody: EditMessageBody,
): Promise<MessageResponse> {
	const [existing] = await db.select().from(message).where(eq(message.id, messageId)).limit(1);

	if (!existing) {
		throw new HTTPException(404, { message: 'Message not found' });
	}
	if (existing.senderId !== senderId) {
		throw new HTTPException(403, { message: 'You can only edit your own messages' });
	}
	if (existing.isDeleted) {
		throw new HTTPException(400, { message: 'Cannot edit a deleted message' });
	}
	if (existing.type !== 'text') {
		throw new HTTPException(400, { message: 'Only text messages can be edited' });
	}

	const { content_enc: newEnc, content_iv: newIv } = encrypt(messageBody.content);
	const updated = await db.transaction(async (tx) => {
		// 3. Insert a new record into messageEditHistory to keep track of the previous content and edit timestamp
		await tx.insert(messageEditHistory).values({
			id: nanoid(),
			messageId: existing.id,
			prevContentIv: existing.contentIv,
			prevContentEnc: existing.contentEnc,
			editedAt: new Date(),
		});
		// 4. Update the message with the new content and edit timestamp
		const [row] = await tx
			.update(message)
			.set({ contentEnc: newEnc, contentIv: newIv, isEdited: true, editedAt: new Date() })
			.where(eq(message.id, messageId))
			.returning();
		return row;
	});

	if (!updated) {
		throw new HTTPException(500, { message: 'Failed to edit message' });
	}

	// 5. Decrypt the updated message
	const formatted = formatMessage(updated);

	// 6. Update Redis cache with the new content
	const cacheKey = RedisKeys.messageCache(existing.conversationId);
	const pipeline = redis.pipeline();
	pipeline.zremrangebyscore(cacheKey, formatted.sequenceNumber, formatted.sequenceNumber);
	pipeline.zadd(cacheKey, formatted.sequenceNumber, JSON.stringify(formatted));
	await pipeline.exec();

	return formatted;
}

export async function softDeleteMessage(messageId: string, requestingUserId: string): Promise<MessageResponse> {
	const [existing] = await db.select().from(message).where(eq(message.id, messageId)).limit(1);

	if (!existing) {
		throw new HTTPException(404, { message: 'Message not found' });
	}
	if (existing.senderId !== requestingUserId) {
		throw new HTTPException(403, { message: 'You can only delete your own messages' });
	}
	if (existing.isDeleted) {
		throw new HTTPException(400, { message: 'Message is already deleted' });
	}

	const [deleted] = await db
		.update(message)
		.set({ isDeleted: true, deletedAt: new Date() })
		.where(eq(message.id, messageId))
		.returning();

	if (!deleted) {
		throw new HTTPException(500, { message: 'Failed to delete message' });
	}

	const formatted = formatMessage(deleted);

	// Update cache — the deleted shape has content: null
	const cacheKey = RedisKeys.messageCache(existing.conversationId);

	const pipeline = redis.pipeline();
	pipeline.zremrangebyscore(cacheKey, formatted.sequenceNumber, formatted.sequenceNumber);
	pipeline.zadd(cacheKey, formatted.sequenceNumber, JSON.stringify(formatted));
	await pipeline.exec();

	return formatted;
}
