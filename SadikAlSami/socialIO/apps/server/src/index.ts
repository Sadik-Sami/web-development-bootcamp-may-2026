import { auth } from '@socialIO/auth';
import { env } from '@socialIO/env/server';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { errorHandler, notFound } from './middlewares';

import type { AppEnv } from './types/app-env';

import { conversationController, messageController, profileController } from './controllers';
import { disconnectRedis, pub, redis, sub } from '@socialIO/db/redis';

const app = new Hono<AppEnv>({ strict: false });

app.use(logger());
app.use(
	'/*',
	cors({
		origin: env.CORS_ORIGIN,
		allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
		allowHeaders: ['Content-Type', 'Authorization'],
		credentials: true,
	}),
);

app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));

app.get('/', (c) => {
	return c.text('SocialIO Server is running.');
});

app.route('/api/profile', profileController);
app.route('/api/conversations', conversationController);
app.route('/api', messageController);
// app.route('/api/presence', presenceController);

app.notFound(notFound);
app.onError(errorHandler);

const server = serve({ fetch: app.fetch, port: Number(env.PORT) }, (info) =>
	console.log(`[server] listening on http://localhost:${info.port}`),
);

Promise.all([redis.connect(), pub.connect(), sub.connect()])
	.then(() => console.log('[server] Redis clients connected'))
	.catch((err) => {
		console.error('[server] Redis connection failed:', err);
		console.warn('[server] Continuing without Redis cache');
	});

process.on('SIGTERM', async () => {
	console.log('[server] SIGTERM — shutting down');
	server.close();
	await disconnectRedis();
	process.exit(0);
});
