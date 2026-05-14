import type { WSContext } from 'hono/ws';

export type EchoPayload = {
	text: string;
};

export type HeartbeatPayload = Record<string, never>;

export type InboundEvent =
	| { type: 'echo'; payload: EchoPayload }
	| { type: 'heartbeat'; payload: HeartbeatPayload };

export type EchoEvent = {
	type: 'echo';
	payload: EchoPayload;
};

export type HeartbeatAckEvent = {
	type: 'heartbeat_ack';
};

export type ErrorEvent = {
	type: 'error';
	error: string;
};

export type OutboundEvent = EchoEvent | HeartbeatAckEvent | ErrorEvent;

export type TypedWS = {
	send: (event: OutboundEvent) => void;
	close: () => void;
};

export function createTypedWS(ws: WSContext): TypedWS {
	return {
		send: (event) => ws.send(JSON.stringify(event)),
		close: () => ws.close(),
	};
}

export function parseInboundEvent(data: string): InboundEvent | null {
	try {
		const parsed = JSON.parse(data) as unknown;

		if (typeof parsed !== 'object' || parsed === null) {
			return null;
		}

		if (!('type' in parsed) || typeof (parsed as Record<string, unknown>).type !== 'string') {
			return null;
		}

		const event = parsed as InboundEvent;

		switch (event.type) {
			case 'echo':
				return typeof event.payload?.text === 'string' ? event : null;
			case 'heartbeat':
				return event;
			default:
				return null;
		}
	} catch {
		return null;
	}
}
