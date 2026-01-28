import { createServer } from 'node:http';
import { Server } from 'socket.io';
import type { Socket } from 'socket.io';

import type {
	FileDeltaPayload,
	RoomJoinPayload,
	RoomSnapshotPayload,
	ServerHelloPayload,
} from '@line-heat/protocol';


type JoinedRoom = {
	repoId: string;
	filePath: string;
};

type ConnectionAuth = {
	userId?: string;
	displayName?: string;
	emoji?: string;
	clientProtocolVersion?: string;
	token?: string;
};

export type MockLineHeatRoom = JoinedRoom;
export type MockLineHeatAuth = ConnectionAuth;

export type MockLineHeatServer = {
	serverUrl: string;
	getLastAuth: () => ConnectionAuth | undefined;
	waitForRoomJoin: (params?: {
		timeoutMs?: number;
		predicate?: (room: JoinedRoom) => boolean;
	}) => Promise<JoinedRoom>;
	emitRoomSnapshot: (payload: RoomSnapshotPayload) => void;
	emitFileDelta: (payload: FileDeltaPayload) => void;
	close: () => Promise<void>;
};

export const startMockLineHeatServer = async (params: {
	token: string;
	retentionDays?: number;
	serverProtocolVersion?: string;
	minClientProtocolVersion?: string;
	autoRoomSnapshot?: (params: {
		room: MockLineHeatRoom;
		auth: MockLineHeatAuth | undefined;
	}) => RoomSnapshotPayload;
}): Promise<MockLineHeatServer> => {
	const protocol = await import('@line-heat/protocol');

	const httpServer = createServer();
	const io = new Server(httpServer, {
		cors: { origin: '*' },
	});

	let lastAuth: ConnectionAuth | undefined;
	let lastSocket: Socket | undefined;
	let joinQueue: JoinedRoom[] = [];
	let joinWaiters: Array<{
		resolve: (room: JoinedRoom) => void;
		reject: (error: Error) => void;
		predicate?: (room: JoinedRoom) => boolean;
	}> = [];

	const flushJoinWaiters = () => {
		if (joinQueue.length === 0 || joinWaiters.length === 0) {
			return;
		}
		const nextQueue: JoinedRoom[] = [];
		for (const room of joinQueue) {
			const waiterIndex = joinWaiters.findIndex((waiter) => !waiter.predicate || waiter.predicate(room));
			if (waiterIndex === -1) {
				nextQueue.push(room);
				continue;
			}
			const [waiter] = joinWaiters.splice(waiterIndex, 1);
			waiter.resolve(room);
		}
		joinQueue = nextQueue;
	};

	io.on('connection', (socket) => {
		lastSocket = socket;
		lastAuth = socket.handshake.auth as ConnectionAuth;
		if (params.token && lastAuth?.token && lastAuth.token !== params.token) {
			socket.disconnect();
			return;
		}
		socket.emit(protocol.EVENT_SERVER_HELLO, {
			serverProtocolVersion: params.serverProtocolVersion ?? protocol.PROTOCOL_VERSION,
			minClientProtocolVersion: params.minClientProtocolVersion ?? protocol.MIN_CLIENT_PROTOCOL_VERSION,
			serverRetentionDays: params.retentionDays ?? protocol.DEFAULT_RETENTION_DAYS,
		} satisfies ServerHelloPayload);
		socket.on(protocol.EVENT_ROOM_JOIN, (payload: RoomJoinPayload) => {
			const room = { repoId: payload.repoId, filePath: payload.filePath };
			joinQueue.push(room);
			if (params.autoRoomSnapshot) {
				const snapshot = params.autoRoomSnapshot({ room, auth: lastAuth });
				socket.emit(protocol.EVENT_ROOM_SNAPSHOT, snapshot);
			}
			flushJoinWaiters();
		});
	});

	await new Promise<void>((resolve) => {
		httpServer.listen(0, '127.0.0.1', () => resolve());
	});
	const address = httpServer.address();
	if (!address || typeof address === 'string') {
		throw new Error('mock server failed to bind');
	}
	const serverUrl = `http://127.0.0.1:${address.port}`;

	const waitForRoomJoin: MockLineHeatServer['waitForRoomJoin'] = async (options = {}) => {
		const timeoutMs = options.timeoutMs ?? 8000;
		return await new Promise<JoinedRoom>((resolve, reject) => {
			const timer = setTimeout(() => {
				const error = new Error('Timed out waiting for room:join');
				reject(error);
			}, timeoutMs);
			joinWaiters.push({
				predicate: options.predicate,
				resolve: (room) => {
					clearTimeout(timer);
					resolve(room);
				},
				reject: (error) => {
					clearTimeout(timer);
					reject(error);
				},
			});
			flushJoinWaiters();
		});
	};

	const emitRoomSnapshot = (payload: RoomSnapshotPayload) => {
		if (!lastSocket) {
			throw new Error('mock server has no connected socket');
		}
		lastSocket.emit(protocol.EVENT_ROOM_SNAPSHOT, payload);
	};

	const emitFileDelta = (payload: FileDeltaPayload) => {
		if (!lastSocket) {
			throw new Error('mock server has no connected socket');
		}
		lastSocket.emit(protocol.EVENT_FILE_DELTA, payload);
	};

	const close = async () => {
		await new Promise<void>((resolve) => {
			io.close(() => {
				httpServer.close(() => resolve());
			});
		});
		for (const waiter of joinWaiters) {
			waiter.reject(new Error('mock server closed'));
		}
		joinWaiters = [];
		joinQueue = [];
	};

	return {
		serverUrl,
		getLastAuth: () => lastAuth,
		waitForRoomJoin,
		emitRoomSnapshot,
		emitFileDelta,
		close,
	};
};
