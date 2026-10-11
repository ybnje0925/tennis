// Verified from the official tennis list on 2026-10-02; rental cate2 differs
// from the Suraksan information page's cate2=21.
export const NOWON_FACILITIES = {
  'nowon-madeul': { name: '마들스포츠타운 테니스장', cate2: '16', courtCount: 9 },
  'nowon-choansan': { name: '초안산스포츠타운 테니스장', cate2: '17', courtCount: 4 },
  'nowon-buramsan': { name: '불암산스포츠타운 테니스장', cate2: '15', courtCount: 3 },
  'nowon-suraksan': { name: '수락산스포츠타운 테니스장', cate2: '117', courtCount: 3 }
};
export const NOWON_TIMES = Array.from({ length: 16 }, (_, i) => `${String(i + 6).padStart(2, '0')}:00~${String(i + 7).padStart(2, '0')}:00`);
export function validateNowonWatch(watch) {
  const venues = watch.venues || [];
  if (!venues.some(id => NOWON_FACILITIES[id])) return;
  if (venues.some(id => !NOWON_FACILITIES[id])) throw new Error('노원 시설은 별도 알림으로 등록하세요.');
  const duration = watch.durationMinutes ?? 60;
  if (![60, 120].includes(duration)) throw new Error('노원 이용시간은 1시간 또는 연속 2시간을 선택하세요.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(watch.date || '') || !Number.isFinite(Date.parse(watch.date + 'T00:00:00+09:00')) || new Date(watch.date + 'T00:00:00Z').toISOString().slice(0, 10) !== watch.date) throw new Error('올바른 노원 이용 날짜를 선택하세요.');
  if (!Array.isArray(watch.times) || !watch.times.length || watch.times.some(time => !NOWON_TIMES.includes(time))) throw new Error('노원 운영시간 안의 1시간 시간대를 선택하세요.');
  if (!Array.isArray(watch.courts ?? []) || (watch.courts || []).some(court => !Number.isInteger(Number(court)) || Number(court) < 1 || venues.some(id => Number(court) > NOWON_FACILITIES[id].courtCount))) throw new Error('선택 시설에 존재하는 코트를 선택하세요.');
  if (duration === 120 && !watch.times.some(time => watch.times.includes(NOWON_TIMES[NOWON_TIMES.indexOf(time) + 1]))) throw new Error('연속 2시간은 인접한 시간대 두 개 이상을 선택하세요.');
}
