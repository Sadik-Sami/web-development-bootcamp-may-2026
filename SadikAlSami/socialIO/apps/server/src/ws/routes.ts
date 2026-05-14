import { upgradeWebSocket } from '@hono/node-server';
import { Hono } from 'hono';
import { createTypedWS, parseInboundEvent } from './types';

export const wsRouter = new Hono();

wsRouter.get(
	'/',
	upgradeWebSocket(() => ({
		onMessage(event, ws) {
			const tws = createTypedWS(ws);
			const raw = typeof event.data === 'string' ? event.data : String(event.data);
			const inbound = parseInboundEvent(raw);

			if (!inbound) {
				tws.send({ type: 'error', error: 'Invalid message format' });
				return;
			}

			switch (inbound.type) {
				case 'echo':
					tws.send({ type: 'echo', payload: inbound.payload });
					return;
				case 'heartbeat':
					tws.send({ type: 'heartbeat_ack' });
					return;
				default: {
					const _exhaustive: never = inbound;
					tws.send({ type: 'error', error: 'Unsupported event' });
					return _exhaustive;
				}
			}
		},
	})),
);
