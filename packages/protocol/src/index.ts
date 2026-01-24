export const PROTOCOL_VERSION = "1.0.0" as const;
export const MIN_CLIENT_PROTOCOL_VERSION = "1.0.0" as const;

export const PRESENCE_TTL_SECONDS = 15 as const;
export const DEFAULT_RETENTION_DAYS = 7 as const;
export const DISPLAY_NAME_MAX_LENGTH = 64 as const;
export const EMOJI_MAX_LENGTH = 16 as const;
export const FILE_PATH_MAX_LENGTH = 512 as const;

export const EVENT_ROOM_JOIN = "room:join" as const;
export const EVENT_ROOM_LEAVE = "room:leave" as const;
export const EVENT_EDIT_PUSH = "edit:push" as const;
export const EVENT_PRESENCE_SET = "presence:set" as const;
export const EVENT_PRESENCE_CLEAR = "presence:clear" as const;
export const EVENT_SERVER_HELLO = "server:hello" as const;
export const EVENT_SERVER_INCOMPATIBLE = "server:incompatible" as const;
export const EVENT_ROOM_SNAPSHOT = "room:snapshot" as const;
export const EVENT_FILE_DELTA = "file:delta" as const;

export type HandshakeAuthPayload = {
  token: string;
  clientProtocolVersion: string;
  userId: string;
  displayName: string;
  emoji: string;
};

export type RoomJoinPayload = {
  repoId: string;
  filePath: string;
};

export type RoomJoinAck =
  | {
      ok: true;
    }
  | {
      ok: false;
      error: string;
    };

export type RoomLeavePayload = {
  repoId: string;
  filePath: string;
};

export type EditPushPayload = {
  repoId: string;
  filePath: string;
  functionId: string;
  anchorLine: number;
};

export type PresenceSetPayload = {
  repoId: string;
  filePath: string;
  functionId: string;
  anchorLine: number;
};

export type PresenceClearPayload = {
  repoId: string;
  filePath: string;
};

export type ServerHelloPayload = {
  serverProtocolVersion: string;
  minClientProtocolVersion: string;
  serverRetentionDays: number;
};

export type ServerIncompatiblePayload = {
  serverProtocolVersion: string;
  minClientProtocolVersion: string;
  message: string;
};

export type HeatEditor = {
  userId: string;
  displayName: string;
  emoji: string;
  lastEditAt: number;
};

export type HeatFunction = {
  functionId: string;
  anchorLine: number;
  lastEditAt: number;
  topEditors: HeatEditor[];
};

export type PresenceUser = {
  userId: string;
  displayName: string;
  emoji: string;
  lastSeenAt: number;
};

export type PresenceFunction = {
  functionId: string;
  anchorLine: number;
  users: PresenceUser[];
};

export type RoomSnapshotPayload = {
  repoId: string;
  filePath: string;
  functions: HeatFunction[];
  presence: PresenceFunction[];
};

export type FileDeltaPayload = {
  repoId: string;
  filePath: string;
  updates: {
    heat?: HeatFunction[];
    presence?: PresenceFunction[];
  };
};
