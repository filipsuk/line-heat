import type { HeatEditor, HeatFunction } from "@line-heat/protocol";

export type StoredEditEvent = {
  serverTs: number;
  repoId: string;
  filePath: string;
  functionId: string;
  anchorLine: number;
  userId: string;
  displayName: string;
  emoji: string;
};

export type HeatRoomState = {
  repoId: string;
  filePath: string;
  functions: Map<string, HeatFunction>;
};

export type HeatState = Map<string, HeatRoomState>;

export const createHeatState = (): HeatState => new Map();

export const getRoomKey = (repoId: string, filePath: string): string =>
  `${repoId}:${filePath}`;

const MAX_TOP_EDITORS = 10;

const upsertEditor = (
  editors: HeatEditor[],
  nextEditor: HeatEditor
): HeatEditor[] => {
  const withoutExisting = editors.filter(
    (editor) => editor.userId !== nextEditor.userId
  );
  const merged = [...withoutExisting, nextEditor];
  merged.sort((left, right) => right.lastEditAt - left.lastEditAt);
  return merged.slice(0, MAX_TOP_EDITORS);
};

export const applyEditEvent = (
  state: HeatState,
  event: StoredEditEvent
): void => {
  const roomKey = getRoomKey(event.repoId, event.filePath);
  let roomState = state.get(roomKey);

  if (!roomState) {
    roomState = {
      repoId: event.repoId,
      filePath: event.filePath,
      functions: new Map(),
    };
    state.set(roomKey, roomState);
  }

  const existingFunction = roomState.functions.get(event.functionId);
  const nextEditor: HeatEditor = {
    userId: event.userId,
    displayName: event.displayName,
    emoji: event.emoji,
    lastEditAt: event.serverTs,
  };

  const nextFunction: HeatFunction = {
    functionId: event.functionId,
    anchorLine: event.anchorLine,
    lastEditAt: event.serverTs,
    topEditors: existingFunction
      ? upsertEditor(existingFunction.topEditors, nextEditor)
      : [nextEditor],
  };

  roomState.functions.set(event.functionId, nextFunction);
};

export const pruneHeatState = (state: HeatState, cutoffTs: number): void => {
  for (const [roomKey, roomState] of state.entries()) {
    for (const [functionId, functionState] of roomState.functions.entries()) {
      if (functionState.lastEditAt < cutoffTs) {
        roomState.functions.delete(functionId);
        continue;
      }

      const nextEditors = functionState.topEditors.filter(
        (editor) => editor.lastEditAt >= cutoffTs
      );
      if (nextEditors.length !== functionState.topEditors.length) {
        roomState.functions.set(functionId, {
          ...functionState,
          topEditors: nextEditors,
        });
      }
    }

    if (roomState.functions.size === 0) {
      state.delete(roomKey);
    }
  }
};
