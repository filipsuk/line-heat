import type { PresenceFunction, PresenceUser } from "@line-heat/protocol";

const MAX_PRESENCE_USERS = 50;

export type SocketPresence = {
  socketId: string;
  userId: string;
  displayName: string;
  emoji: string;
  functionId: string;
  anchorLine: number;
  lastSeenAt: number;
};

export type PresenceRoomState = {
  repoId: string;
  filePath: string;
  sockets: Map<string, SocketPresence>;
  aggregated: Map<string, PresenceFunction>;
};

export type PresenceRoomDelta = {
  repoId: string;
  filePath: string;
  updates: PresenceFunction[];
};

const compareUsers = (left: PresenceUser, right: PresenceUser): number =>
  right.lastSeenAt - left.lastSeenAt;

const presenceUsersEqual = (
  left: PresenceUser[],
  right: PresenceUser[]
): boolean => {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const leftUser = left[index];
    const rightUser = right[index];
    if (!leftUser || !rightUser) {
      return false;
    }
    if (
      leftUser.userId !== rightUser.userId ||
      leftUser.displayName !== rightUser.displayName ||
      leftUser.emoji !== rightUser.emoji ||
      leftUser.lastSeenAt !== rightUser.lastSeenAt
    ) {
      return false;
    }
  }
  return true;
};

const aggregatePresence = (
  room: PresenceRoomState
): Map<string, PresenceFunction> => {
  const latestByUser = new Map<string, SocketPresence>();

  for (const entry of room.sockets.values()) {
    const existing = latestByUser.get(entry.userId);
    if (!existing || entry.lastSeenAt > existing.lastSeenAt) {
      latestByUser.set(entry.userId, entry);
    }
  }

  const byFunction = new Map<
    string,
    { anchorLine: number; anchorTs: number; users: PresenceUser[] }
  >();

  for (const entry of latestByUser.values()) {
    const existing = byFunction.get(entry.functionId);
    const user: PresenceUser = {
      userId: entry.userId,
      displayName: entry.displayName,
      emoji: entry.emoji,
      lastSeenAt: entry.lastSeenAt,
    };
    if (!existing) {
      byFunction.set(entry.functionId, {
        anchorLine: entry.anchorLine,
        anchorTs: entry.lastSeenAt,
        users: [user],
      });
    } else {
      existing.users.push(user);
      if (entry.lastSeenAt > existing.anchorTs) {
        existing.anchorLine = entry.anchorLine;
        existing.anchorTs = entry.lastSeenAt;
      }
    }
  }

  const aggregated = new Map<string, PresenceFunction>();
  for (const [functionId, group] of byFunction.entries()) {
    group.users.sort(compareUsers);
    aggregated.set(functionId, {
      functionId,
      anchorLine: group.anchorLine,
      users: group.users.slice(0, MAX_PRESENCE_USERS),
    });
  }

  return aggregated;
};

const diffPresence = (
  previous: Map<string, PresenceFunction>,
  next: Map<string, PresenceFunction>
): PresenceFunction[] => {
  const updates: PresenceFunction[] = [];
  const seen = new Set<string>();

  for (const [functionId, nextEntry] of next.entries()) {
    const prevEntry = previous.get(functionId);
    seen.add(functionId);
    if (!prevEntry || !presenceUsersEqual(prevEntry.users, nextEntry.users)) {
      updates.push(nextEntry);
    }
  }

  for (const [functionId, prevEntry] of previous.entries()) {
    if (seen.has(functionId)) {
      continue;
    }
    updates.push({
      functionId,
      anchorLine: prevEntry.anchorLine,
      users: [],
    });
  }

  return updates;
};

export class PresenceState {
  private readonly rooms = new Map<string, PresenceRoomState>();

  setPresence(
    roomKey: string,
    repoId: string,
    filePath: string,
    presence: SocketPresence
  ): PresenceRoomDelta | null {
    const room = this.ensureRoom(roomKey, repoId, filePath);
    room.sockets.set(presence.socketId, presence);
    return this.refreshRoom(room);
  }

  clearPresence(roomKey: string, socketId: string): PresenceRoomDelta | null {
    const room = this.rooms.get(roomKey);
    if (!room) {
      return null;
    }
    if (!room.sockets.delete(socketId)) {
      return null;
    }
    return this.refreshRoom(room);
  }

  removeSocket(socketId: string): PresenceRoomDelta[] {
    const updates: PresenceRoomDelta[] = [];
    for (const [, room] of this.rooms.entries()) {
      if (!room.sockets.delete(socketId)) {
        continue;
      }
      const updated = this.refreshRoom(room);
      if (updated) {
        updates.push(updated);
      }
    }
    return updates;
  }

  cleanupExpired(cutoffTs: number): PresenceRoomDelta[] {
    const updates: PresenceRoomDelta[] = [];
    for (const [, room] of this.rooms.entries()) {
      let removed = false;
      for (const [socketId, entry] of room.sockets.entries()) {
        if (entry.lastSeenAt < cutoffTs) {
          room.sockets.delete(socketId);
          removed = true;
        }
      }
      if (removed) {
        const updated = this.refreshRoom(room);
        if (updated) {
          updates.push(updated);
        }
      }
    }
    return updates;
  }

  getSnapshot(roomKey: string): PresenceFunction[] {
    const room = this.rooms.get(roomKey);
    if (!room) {
      return [];
    }
    return Array.from(room.aggregated.values());
  }

  private ensureRoom(
    roomKey: string,
    repoId: string,
    filePath: string
  ): PresenceRoomState {
    let room = this.rooms.get(roomKey);
    if (!room) {
      room = {
        repoId,
        filePath,
        sockets: new Map(),
        aggregated: new Map(),
      };
      this.rooms.set(roomKey, room);
    }
    return room;
  }

  private refreshRoom(room: PresenceRoomState): PresenceRoomDelta | null {
    const nextAggregated = aggregatePresence(room);
    const updates = diffPresence(room.aggregated, nextAggregated);
    room.aggregated = nextAggregated;
    if (updates.length === 0) {
      return null;
    }
    return {
      repoId: room.repoId,
      filePath: room.filePath,
      updates,
    };
  }
}
