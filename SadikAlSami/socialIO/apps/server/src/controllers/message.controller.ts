import { Hono } from 'hono';
import { type AppEnv } from '@/types/app-env';
import { HTTPException } from 'hono/http-exception';
import { sendMessage, getMessages, editMessage, softDeleteMessage } from '@/services';
import { isAuthenticated, validate, isMember } from '@/middlewares';
import {
	conversationIdParamSchema,
	createMessageBodySchema,
	editMessageBodySchema,
	messageIdParamSchema,
	messageListQuerySchema,
} from '@/validators';

export const messageController = new Hono<AppEnv>();

/**
 * @description
 * - `GET    /api/conversations/:id/messages`          — paginated message fetch (cursor-based)
 * - `POST   /api/conversations/:id/messages`          — send a message
 * - `PATCH  /api/conversations/:id/messages/:msgId`   — edit a message (sender only)
 * - `DELETE /api/conversations/:id/messages/:msgId`   — soft-delete a message (sender only)
 *
 * All routes require authentication + active participant membership.
 */

messageController.get(
	'/conversations/:id/messages',
	isAuthenticated,
	isMember,
	validate('query', messageListQuerySchema),
	async (c) => {
		const user = c.get('user');
		const userId = user?.id;

		if (!userId) {
			throw new HTTPException(401, { message: 'Unauthorized' });
		}

		const conversationId = c.req.param('id');
		const { cursor, limit } = c.req.valid('query');

		const messages = await getMessages(conversationId, cursor, limit);

		return c.json({
			success: true,
			messages,
			hasMore: messages.length === limit,
		});
	},
);

messageController.post(
	'/conversations/:id/messages',
	isAuthenticated,
	isMember,
	validate('param', conversationIdParamSchema),
	validate('json', createMessageBodySchema),
	async (c) => {
		const user = c.get('user');
		const userId = user?.id;
		if (!userId) {
			throw new HTTPException(401, { message: 'Unauthorized' });
		}

		const { id: conversationId } = c.req.valid('param');
		const messageBody = c.req.valid('json');

		const message = await sendMessage(conversationId, userId, messageBody);
		return c.json({ success: true, message }, 201);
	},
);

messageController.patch(
	'/conversations/:id/messages/:msgId',
	isAuthenticated,
	isMember,
	validate('param', messageIdParamSchema),
	validate('json', editMessageBodySchema),
	async (c) => {
		const user = c.get('user');
		const userId = user?.id;
		if (!userId) {
			throw new HTTPException(401, { message: 'Unauthorized' });
		}

		// const messageId = c.req.param('msgId');
		const { id: messageId } = c.req.valid('param');
		const messageBody = c.req.valid('json');

		const updatedMessage = await editMessage(messageId, userId, messageBody);
		return c.json({ success: true, message: updatedMessage });
	},
);

messageController.delete(
	'/conversations/:id/messages/:msgId',
	isAuthenticated,
	isMember,
	validate('param', messageIdParamSchema),
	async (c) => {
		const user = c.get('user');
		const userId = user?.id;
		if (!userId) {
			throw new HTTPException(401, { message: 'Unauthorized' });
		}

		// const messageId = c.req.param('msgId');
		const { id: messageId } = c.req.valid('param');

		const deletedMessage = await softDeleteMessage(messageId, userId);
		return c.json({ success: true, deletedMessage });
	},
);
