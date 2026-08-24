import { VENUES } from "./constants.js";

export function getVenueSlotMinutes(venueId) {
  return VENUES[venueId]?.slotMinutes;
}

export function getSelectedSlotMinuteGroups(venueIds) {
  return Array.from(new Set(
    venueIds.map(getVenueSlotMinutes).filter((value) => Number.isFinite(value))
  )).sort((a, b) => a - b);
}

export function validateVenueSelection(venueIds) {
  if (!Array.isArray(venueIds) || venueIds.length === 0) {
    return { ok: false, message: "테니스장을 선택하세요." };
  }

  const unknown = venueIds.find((venueId) => !VENUES[venueId]);
  if (unknown) return { ok: false, message: `알 수 없는 테니스장입니다: ${unknown}` };

  const groups = getSelectedSlotMinuteGroups(venueIds);
  if (groups.length > 1) {
    return {
      ok: false,
      message: "예약단위가 다른 시설은 하나의 알림 조건으로 등록할 수 없습니다."
    };
  }

  return { ok: true, slotMinutes: groups[0] };
}

export function disabledVenueIdsForSelection(selectedVenueIds) {
  const groups = getSelectedSlotMinuteGroups(selectedVenueIds);
  if (groups.length !== 1) return [];
  const selectedSlotMinutes = groups[0];
  return Object.values(VENUES)
    .filter((venue) => venue.slotMinutes !== selectedSlotMinutes)
    .map((venue) => venue.id);
}
