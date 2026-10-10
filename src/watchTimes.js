import { VENUES, TIME_SLOTS, ONE_HOUR_TIME_SLOTS } from "./constants.js";
import { myeonmokSlots } from "../public/myeonmokSlots.js";

// Materialize the venue's operating slots so existing provider query and matching
// paths use exactly the same times for unrestricted and explicit conditions.
export function resolveWatchTimes(input) {
  if (input.anyTime !== undefined && typeof input.anyTime !== "boolean") throw new Error("시간 무관 설정은 참 또는 거짓이어야 합니다.");
  if (!input.anyTime) return input.times;
  if (input.venues?.includes("myeonmok")) return myeonmokSlots(input.date);
  return input.venues?.some(id => VENUES[id]?.slotMinutes === 60) ? [...ONE_HOUR_TIME_SLOTS] : [...TIME_SLOTS];
}
