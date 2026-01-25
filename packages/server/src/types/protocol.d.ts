declare module "@line-heat/protocol" {
  export const PROTOCOL_VERSION: string;
  export const MIN_CLIENT_PROTOCOL_VERSION: string;
  export const PRESENCE_TTL_SECONDS: number;
  export const DEFAULT_RETENTION_DAYS: number;
  export const DISPLAY_NAME_MAX_LENGTH: number;
  export const EMOJI_MAX_LENGTH: number;
  export const FILE_PATH_MAX_LENGTH: number;

  export const EVENT_ROOM_JOIN: string;
  export const EVENT_ROOM_LEAVE: string;
  export const EVENT_EDIT_PUSH: string;
  export const EVENT_PRESENCE_SET: string;
  export const EVENT_PRESENCE_CLEAR: string;
  export const EVENT_SERVER_HELLO: string;
  export const EVENT_SERVER_INCOMPATIBLE: string;
  export const EVENT_ROOM_SNAPSHOT: string;
  export const EVENT_FILE_DELTA: string;

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
}
