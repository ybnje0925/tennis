import { config } from '../config.js';
import { NOWON_FACILITIES } from '../../public/nowonRules.js';
import { diagnosticError, classifyError } from '../diagnostics.js';
import { nowonAuth } from './nowonAuth.js';
import { validateNowonRows } from './nowonSlots.js';

const inFlightDays = new Map();
export const NOWON_TIMETABLE_VERIFIED = false;
export function nowonVenueIdsFromWatches(watches) { return [...new Set(watches.flatMap(w => w.venues || []).filter(id => NOWON_FACILITIES[id]))]; }
function structureError() {
  return diagnosticError({ provider: 'nowon', stage: 'PARSE', type: 'NOWON_STRUCTURE_UNVERIFIED', retryable: false, message: '노원 상세 시간표의 인증 후 HTML·요청 구조를 아직 검증하지 못했습니다. 빈자리 알림은 중단됩니다.' });
}
// Explicit release gate. The authenticated date request and display-state
// selectors cannot be inferred from the public calendar or checkbox presence.
async function verifiedDayLoader() { throw structureError(); }

export async function checkNowonVenues(venueIds, { venueDates = {}, loadDay = verifiedDayLoader, auth = nowonAuth, credentialsConfigured = Boolean(config.nowonUsername && config.nowonPassword) } = {}) {
  const result = {}, errors = [];
  const ids = [...new Set(venueIds.filter(id => NOWON_FACILITIES[id]))];
  // Sequential facility/date requests: at most one upstream day request at once.
  for (const venueId of ids) {
    const dates = [...new Set(venueDates[venueId] || [])].sort();
    if (!dates.length) continue;
    try {
      if (!credentialsConfigured) throw diagnosticError({ provider: 'nowon', type: 'NOWON_LOGIN_CONFIG_REQUIRED', stage: 'AUTH_OR_PROTECTION', message: '노원 로그인 설정 필요', retryable: false });
      if (loadDay === verifiedDayLoader && !NOWON_TIMETABLE_VERIFIED) throw structureError();
      const items = [];
      for (const date of dates) {
        const key = `${venueId}|${date}`;
        if (!inFlightDays.has(key)) {
          const pending = Promise.resolve().then(() => loadDay({ venueId, date, facility: NOWON_FACILITIES[venueId], auth }));
          inFlightDays.set(key, pending);
        }
        const pending = inFlightDays.get(key);
        try { items.push(...validateNowonRows(await pending, { venueId, date })); }
        finally { if (inFlightDays.get(key) === pending) inFlightDays.delete(key); }
      }
      // A failed date never produces an empty successful venue result.
      result[venueId] = items;
    } catch (failure) {
      errors.push(classifyError(failure, { provider: 'nowon', venueId, targetDate: dates.join(', ') }));
    }
  }
  Object.defineProperty(result, Symbol.for('tennis.checkMeta'), { value: { errors }, enumerable: false });
  return result;
}
