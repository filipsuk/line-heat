import type { StoredEditEvent } from "../domain/heatState.js";
import { applyEditEvent, createHeatState } from "../domain/heatState.js";
import type { HeatState } from "../domain/heatState.js";

export const replayHeatState = (events: StoredEditEvent[]): HeatState => {
  const state = createHeatState();
  for (const event of events) {
    applyEditEvent(state, event);
  }
  return state;
};
