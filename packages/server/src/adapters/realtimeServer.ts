import type { Server, Socket } from "socket.io";
import {
  DISPLAY_NAME_MAX_LENGTH,
  EMOJI_MAX_LENGTH,
  EVENT_EDIT_PUSH,
  EVENT_FILE_DELTA,
  EVENT_PRESENCE_CLEAR,
  EVENT_PRESENCE_SET,
  EVENT_ROOM_JOIN,
  EVENT_ROOM_LEAVE,
  EVENT_ROOM_SNAPSHOT,
  EVENT_SERVER_HELLO,
  EVENT_SERVER_INCOMPATIBLE,
  FILE_PATH_MAX_LENGTH,
  MIN_CLIENT_PROTOCOL_VERSION,
  PRESENCE_TTL_SECONDS,
  PROTOCOL_VERSION,
} from "@line-heat/protocol";
import * as protocol from "@line-heat/protocol";
import type {
  EditPushPayload,
  FileDeltaPayload,
  HandshakeAuthPayload,
  PresenceClearPayload,
  PresenceSetPayload,
  RoomJoinAck,
  RoomJoinPayload,
  RoomLeavePayload,
  ServerHelloPayload,
  ServerIncompatiblePayload,
} from "@line-heat/protocol";

import { applyEditEvent, getRoomKey } from "../domain/heatState.js";
import type { HeatState } from "../domain/heatState.js";
import { PresenceState } from "../domain/presenceState.js";
import { compareSemver, parseSemver } from "../domain/semver.js";
import type { SqliteEventStore } from "./sqliteEventStore.js";
import { logger } from "./logger.js";

type RealtimeServerOptions = {
  io: Server;
  token: string;
  retentionDays: number;
  eventStore: SqliteEventStore;
  heatState: HeatState;
};

type SocketUser = {
  userId: string;
  displayName: string;
  emoji: string;
};

type PendingDelta = {
  repoId: string;
  filePath: string;
  hashVersion: string;
  heat: Map<string, HeatUpdate>;
  presence: Map<string, PresenceUpdate>;
  timer: NodeJS.Timeout | null;
};

const DELTA_COALESCE_MS = 200;
const PRESENCE_CLEANUP_MS = 5000;
const HASH_VERSION = (protocol as unknown as { HASH_VERSION: string }).HASH_VERSION;
const HASH_HEX_RE = /^[0-9a-f]{64}$/;

type HeatUpdate = NonNullable<FileDeltaPayload["updates"]["heat"]>[number];
type PresenceUpdate =
  NonNullable<FileDeltaPayload["updates"]["presence"]>[number];

const parseProtocol = (value: string): ReturnType<typeof parseSemver> =>
  parseSemver(value);

export const attachRealtimeServer = (options: RealtimeServerOptions) => {
  const { io, token, retentionDays, eventStore, heatState } = options;
  const presenceState = new PresenceState();
  const pendingDeltas = new Map<string, PendingDelta>();

  const serverProtocol = parseProtocol(PROTOCOL_VERSION);
  const minClientProtocol = parseProtocol(MIN_CLIENT_PROTOCOL_VERSION);

  if (!serverProtocol || !minClientProtocol) {
    throw new Error("Protocol constants are invalid semver.");
  }

  const queueDelta = (
    roomKey: string,
    repoId: string,
    filePath: string,
    updates: FileDeltaPayload["updates"],
    hashVersion: string
  ): void => {
    let pending = pendingDeltas.get(roomKey);
    if (!pending) {
      pending = {
        repoId,
        filePath,
        hashVersion,
        heat: new Map(),
        presence: new Map(),
        timer: null,
      };
      pendingDeltas.set(roomKey, pending);
    } else if (hashVersion !== pending.hashVersion) {
      pending.hashVersion = hashVersion;
    }

    if (updates.heat) {
      for (const update of updates.heat) {
        pending.heat.set(update.functionId, update);
      }
    }

    if (updates.presence) {
      for (const update of updates.presence) {
        pending.presence.set(update.functionId, update);
      }
    }

    if (!pending.timer) {
      pending.timer = setTimeout(() => {
        const next = pendingDeltas.get(roomKey);
        if (!next) {
          return;
        }
        const heat = next.heat.size ? Array.from(next.heat.values()) : undefined;
        const presence = next.presence.size
          ? Array.from(next.presence.values())
          : undefined;
        if (heat || presence) {
          io.to(roomKey).emit(EVENT_FILE_DELTA, {
            hashVersion: next.hashVersion,
            repoId: next.repoId,
            filePath: next.filePath,
            updates: {
              ...(heat ? { heat } : {}),
              ...(presence ? { presence } : {}),
            },
          });
        }
        next.heat.clear();
        next.presence.clear();
        next.timer = null;
      }, DELTA_COALESCE_MS);
    }
  };

  const ensureJoined = (socket: Socket, roomKey: string): boolean => {
    const joined = socket.data.joinedRooms as Set<string> | undefined;
    return Boolean(joined?.has(roomKey));
  };

  const validateRoomPayload = (
    payload: RoomJoinPayload | RoomLeavePayload
  ): string | null => {
    if (!payload || typeof payload !== "object") {
      return "payload is required";
    }
    const hashVersion =
      typeof payload.hashVersion === "string" ? payload.hashVersion.trim() : "";
    if (!hashVersion) {
      return "hashVersion is required";
    }
    if (hashVersion !== HASH_VERSION) {
      return "hashVersion must match HASH_VERSION";
    }
    if (typeof payload.repoId !== "string" || payload.repoId.trim().length === 0) {
      return "repoId is required";
    }
    if (typeof payload.filePath !== "string") {
      return "filePath is required";
    }
    const filePath = payload.filePath.trim();
    if (filePath.length === 0) {
      return "filePath is required";
    }
    if (filePath.length > FILE_PATH_MAX_LENGTH) {
      return "filePath is too long";
    }
    if (!HASH_HEX_RE.test(payload.repoId.trim())) {
      return "repoId must be sha256 hex";
    }
    if (!HASH_HEX_RE.test(filePath)) {
      return "filePath must be sha256 hex";
    }
    return null;
  };

  const validateEditPayload = (payload: EditPushPayload): string | null => {
    const roomError = validateRoomPayload(payload);
    if (roomError) {
      return roomError;
    }
    if (typeof payload.functionId !== "string" || payload.functionId.length === 0) {
      return "functionId is required";
    }
    if (!HASH_HEX_RE.test(payload.functionId)) {
      return "functionId must be sha256 hex";
    }
    if (!Number.isInteger(payload.anchorLine) || payload.anchorLine <= 0) {
      return "anchorLine must be positive";
    }
    return null;
  };

  const validatePresenceSetPayload = (payload: PresenceSetPayload): string | null =>
    validateEditPayload(payload);

  const validatePresenceClearPayload = (
    payload: PresenceClearPayload
  ): string | null => validateRoomPayload(payload);

  const checkCompatibility = (clientProtocolVersion: string) => {
    if (!clientProtocolVersion) {
      return "Client protocol version missing.";
    }
    const parsedClient = parseProtocol(clientProtocolVersion);
    if (!parsedClient) {
      return "Client protocol version is invalid.";
    }
    if (parsedClient.major !== serverProtocol.major) {
      return "Client protocol major version mismatch.";
    }
    if (compareSemver(parsedClient, minClientProtocol) < 0) {
      return "Client protocol is below minimum supported version.";
    }
    return null;
  };

  io.use((socket: Socket, next: (err?: Error) => void) => {
    const auth = (socket.handshake.auth ?? {}) as Partial<HandshakeAuthPayload>;
    const candidateToken =
      typeof auth.token === "string" ? auth.token.trim() : "";
    if (!candidateToken || candidateToken !== token) {
      return next(new Error("Invalid token"));
    }

    const userId = typeof auth.userId === "string" ? auth.userId.trim() : "";
    const displayName =
      typeof auth.displayName === "string" ? auth.displayName.trim() : "";
    const emoji = typeof auth.emoji === "string" ? auth.emoji.trim() : "";

    if (!userId || !displayName || !emoji) {
      return next(new Error("Invalid user identity"));
    }
    if (displayName.length > DISPLAY_NAME_MAX_LENGTH) {
      return next(new Error("Display name too long"));
    }
    if (emoji.length > EMOJI_MAX_LENGTH) {
      return next(new Error("Emoji too long"));
    }

    const clientProtocolVersion =
      typeof auth.clientProtocolVersion === "string"
        ? auth.clientProtocolVersion.trim()
        : "";

    socket.data.user = { userId, displayName, emoji } satisfies SocketUser;
    socket.data.clientProtocolVersion = clientProtocolVersion;
    socket.data.joinedRooms = new Set<string>();

    return next();
  });

  io.on("connection", (socket: Socket) => {
    const socketUser = socket.data.user as SocketUser | undefined;
    if (!socketUser) {
      socket.disconnect(true);
      return;
    }

    const clientProtocolVersion =
      typeof socket.data.clientProtocolVersion === "string"
        ? socket.data.clientProtocolVersion
        : "";
    const compatibilityError = checkCompatibility(clientProtocolVersion);
    if (compatibilityError) {
      logger.warn("Connection rejected due to protocol incompatibility", {
        userId: socketUser.userId,
        displayName: socketUser.displayName,
        reason: compatibilityError,
      });
      const payload: ServerIncompatiblePayload = {
        serverProtocolVersion: PROTOCOL_VERSION,
        minClientProtocolVersion: MIN_CLIENT_PROTOCOL_VERSION,
        message: compatibilityError,
      };
      socket.emit(EVENT_SERVER_INCOMPATIBLE, payload);
      setTimeout(() => socket.disconnect(true), 0);
      return;
    }

    logger.info("Client connected", {
      userId: socketUser.userId,
      displayName: socketUser.displayName,
      clientProtocolVersion,
    });

    const helloPayload: ServerHelloPayload = {
      serverProtocolVersion: PROTOCOL_VERSION,
      minClientProtocolVersion: MIN_CLIENT_PROTOCOL_VERSION,
      serverRetentionDays: retentionDays,
    };
    socket.emit(EVENT_SERVER_HELLO, helloPayload);

    socket.on(
      EVENT_ROOM_JOIN,
      (payload: RoomJoinPayload, ack?: (response: RoomJoinAck) => void) => {
        const error = validateRoomPayload(payload);
        if (error) {
          logger.debug("Room join rejected", {
            userId: socketUser.userId,
            displayName: socketUser.displayName,
            error,
          });
          if (typeof ack === "function") {
            ack({ ok: false, error });
          }
          return;
        }

        const roomKey = getRoomKey(payload.repoId, payload.filePath);
        logger.info("Client joined room", {
          userId: socketUser.userId,
          displayName: socketUser.displayName,
          roomKey,
        });
        socket.join(roomKey);
        const joinedRooms = socket.data.joinedRooms as Set<string> | undefined;
        joinedRooms?.add(roomKey);
        if (typeof ack === "function") {
          ack({ ok: true });
        }

        const roomState = heatState.get(roomKey);
        socket.emit(EVENT_ROOM_SNAPSHOT, {
          hashVersion: payload.hashVersion,
          repoId: payload.repoId,
          filePath: payload.filePath,
          functions: roomState ? Array.from(roomState.functions.values()) : [],
          presence: presenceState.getSnapshot(roomKey),
        });
      }
    );

    socket.on(EVENT_ROOM_LEAVE, (payload: RoomLeavePayload) => {
      const error = validateRoomPayload(payload);
      if (error) {
        return;
      }
      const roomKey = getRoomKey(payload.repoId, payload.filePath);
      const joinedRooms = socket.data.joinedRooms as Set<string> | undefined;
      if (!joinedRooms?.has(roomKey)) {
        return;
      }
      logger.info("Client left room", {
        userId: socketUser.userId,
        displayName: socketUser.displayName,
        roomKey,
      });
      joinedRooms.delete(roomKey);
      socket.leave(roomKey);
      const presenceUpdate = presenceState.clearPresence(roomKey, socket.id);
      if (presenceUpdate) {
        queueDelta(roomKey, payload.repoId, payload.filePath, {
          presence: presenceUpdate.updates,
        }, payload.hashVersion);
      }
    });

    socket.on(EVENT_EDIT_PUSH, (payload: EditPushPayload) => {
      const error = validateEditPayload(payload);
      if (error) {
        return;
      }
      const roomKey = getRoomKey(payload.repoId, payload.filePath);
      if (!ensureJoined(socket, roomKey)) {
        return;
      }

      logger.debug("Client pushed edit", {
        userId: socketUser.userId,
        displayName: socketUser.displayName,
        roomKey,
        functionId: payload.functionId,
        anchorLine: payload.anchorLine,
      });

      const now = Date.now();
      const event = {
        serverTs: now,
        repoId: payload.repoId,
        filePath: payload.filePath,
        functionId: payload.functionId,
        anchorLine: payload.anchorLine,
        userId: socketUser.userId,
        displayName: socketUser.displayName,
        emoji: socketUser.emoji,
      };

      eventStore.insertEvent(event);
      applyEditEvent(heatState, event);
      const roomState = heatState.get(roomKey);
      const heatFunction = roomState?.functions.get(payload.functionId);
      if (heatFunction) {
        queueDelta(roomKey, payload.repoId, payload.filePath, {
          heat: [heatFunction],
        }, payload.hashVersion);
      }
    });

    socket.on(EVENT_PRESENCE_SET, (payload: PresenceSetPayload) => {
      const error = validatePresenceSetPayload(payload);
      if (error) {
        return;
      }
      const roomKey = getRoomKey(payload.repoId, payload.filePath);
      if (!ensureJoined(socket, roomKey)) {
        return;
      }

      logger.debug("Client set presence", {
        userId: socketUser.userId,
        displayName: socketUser.displayName,
        roomKey,
        functionId: payload.functionId,
        anchorLine: payload.anchorLine,
      });

      const update = presenceState.setPresence(roomKey, payload.repoId, payload.filePath, {
        socketId: socket.id,
        userId: socketUser.userId,
        displayName: socketUser.displayName,
        emoji: socketUser.emoji,
        functionId: payload.functionId,
        anchorLine: payload.anchorLine,
        lastSeenAt: Date.now(),
      });

      if (update) {
        queueDelta(roomKey, payload.repoId, payload.filePath, {
          presence: update.updates,
        }, payload.hashVersion);
      }
    });

    socket.on(EVENT_PRESENCE_CLEAR, (payload: PresenceClearPayload) => {
      const error = validatePresenceClearPayload(payload);
      if (error) {
        return;
      }
      const roomKey = getRoomKey(payload.repoId, payload.filePath);
      if (!ensureJoined(socket, roomKey)) {
        return;
      }
      logger.debug("Client cleared presence", {
        userId: socketUser.userId,
        displayName: socketUser.displayName,
        roomKey,
      });
      const update = presenceState.clearPresence(roomKey, socket.id);
      if (update) {
        queueDelta(roomKey, payload.repoId, payload.filePath, {
          presence: update.updates,
        }, payload.hashVersion);
      }
    });

    socket.on("disconnect", () => {
      logger.info("Client disconnected", {
        userId: socketUser.userId,
        displayName: socketUser.displayName,
      });
      const updates = presenceState.removeSocket(socket.id);
      for (const update of updates) {
        const roomKey = getRoomKey(update.repoId, update.filePath);
        queueDelta(roomKey, update.repoId, update.filePath, {
          presence: update.updates,
        }, HASH_VERSION);
      }
    });
  });

  const presenceInterval = setInterval(() => {
    const cutoff = Date.now() - PRESENCE_TTL_SECONDS * 1000;
    const updates = presenceState.cleanupExpired(cutoff);
    for (const update of updates) {
      const roomKey = getRoomKey(update.repoId, update.filePath);
      queueDelta(roomKey, update.repoId, update.filePath, {
        presence: update.updates,
      }, HASH_VERSION);
    }
  }, PRESENCE_CLEANUP_MS);

  return {
    close: () => {
      clearInterval(presenceInterval);
      for (const pending of pendingDeltas.values()) {
        if (pending.timer) {
          clearTimeout(pending.timer);
        }
      }
    },
  };
};
