import { diagnosticError } from '../diagnostics.js';
import { NOWON_FACILITIES, NOWON_TIMES } from '../../public/nowonRules.js';
const fail = (type, message) => diagnosticError({ provider: 'nowon', stage: 'PARSE', type, message, retryable: false });

// Internal normalized contract only. No HTML selector/color code is fabricated.
// The production HTML->rows adapter stays disabled until authenticated evidence
// establishes the actual tags/classes/styles and underlying state fields.
export function validateNowonRows(rows, { venueId, date }) {
  const facility = NOWON_FACILITIES[venueId];
  if (!facility || !Array.isArray(rows) || !rows.length) throw fail('NOWON_STRUCTURE_UNVERIFIED', '노원 상세 시간표 구조 확인이 필요합니다.');
  const seen = new Set();
  return rows.map(row => {
    const courtNo = String(row.courtNo);
    const time = `${row.startTime}~${row.endTime}`;
    const key = `${courtNo}|${time}`;
    if (row.date !== date || row.cate2 !== facility.cate2 || !/^\d+$/.test(courtNo) || Number(courtNo) < 1 || Number(courtNo) > facility.courtCount || !NOWON_TIMES.includes(time) || seen.has(key)) throw fail('PARSE_FAILED', '노원 시설·날짜·코트·시간 매핑을 확인하지 못했습니다.');
    seen.add(key);
    if (row.display === 'blue' && (row.disabled || row.explicitUnavailable)) throw fail('NOWON_STATE_CONFLICT', '노원 파란 시간과 예약불가 상태가 충돌합니다. 알림을 중단합니다.');
    if (!['blue', 'red-strike'].includes(row.display)) throw fail('PARSE_FAILED', '노원 슬롯 상태를 확인하지 못했습니다.');
    return { provider: 'nowon', venue: venueId, venueName: facility.name, date, courtNo,
      startTime: row.startTime, endTime: row.endTime, time, durationMinutes: 60,
      available: row.display === 'blue', status: row.display === 'blue' ? '예약가능' : '예약불가' };
  });
}
export function nowonKeyFor(item) {
  return ['nowon', item.venue, item.date, item.courtNo, item.startTime, item.endTime].join('|');
}
export function isNowonWatch(watch) { return (watch.venues || []).some(id => NOWON_FACILITIES[id]); }
export function filterNowonSlotsByWatch(slots, watch) {
  const times = new Set(watch.times || []);
  const courts = new Set((watch.courts || []).map(String));
  const eligible = slots.filter(slot => slot.provider === 'nowon' && slot.available === true && slot.date === watch.date && (watch.venues || []).includes(slot.venue) && (!courts.size || courts.has(String(slot.courtNo))) && times.has(slot.time));
  if ((watch.durationMinutes ?? 60) === 60) return Array.from(new Map(eligible.map(slot => [nowonKeyFor(slot), slot])).values());
  const byStart = new Map(eligible.map(slot => [[slot.venue, slot.date, slot.courtNo, slot.startTime].join('|'), slot]));
  return eligible.flatMap(first => {
    const next = byStart.get([first.venue, first.date, first.courtNo, first.endTime].join('|'));
    if (!next || next.startTime !== first.endTime || first.durationMinutes !== 60 || next.durationMinutes !== 60) return [];
    return [{ ...first, endTime: next.endTime, time: `${first.startTime}~${next.endTime}`, durationMinutes: 120, sourceSlots: [first.time, next.time] }];
  });
}
