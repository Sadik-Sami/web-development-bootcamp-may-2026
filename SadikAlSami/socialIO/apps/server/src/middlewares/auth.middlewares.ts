import { auth } from '@socialIO/auth';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types/app-env';

const unauthorizedResponse = {
	success: false,
	message: 'Unauthorized',
	error: 'No Valid session found',
} as const;

export const isAuthenticated: MiddlewareHandler<AppEnv> = async (c, next) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });

	if (!session || !session.user) {
		return c.json(unauthorizedResponse, 401);
	}

	c.set('user', session.user);
	c.set('session', session.session);

  await next();
};
