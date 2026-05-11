import { auth } from '@socialIO/auth';
import { env } from '@socialIO/env/server';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { errorHandler, notFound } from './middlewares';

import type { AppEnv } from './types/app-env';
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

app.notFound(notFound);
app.onError(errorHandler);
serve(
	{
		fetch: app.fetch,
		port: 3000,
	},
	(info) => {
		console.log(`Server is running on http://localhost:${info.port}`);
	},
);
