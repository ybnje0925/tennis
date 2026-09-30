// Official seasonal schedule, selected by use date.
export function myeonmokSlots(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return [];
  const parsed = new Date(date + "T00:00:00Z");
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return [];
  const month = Number(date.slice(5, 7));
  return month >= 4 && month <= 9
    ? ["07:00~08:50", "09:00~10:50", "11:00~12:50", "13:00~14:50", "15:00~16:50", "17:00~18:50"]
    : ["08:00~09:50", "10:00~11:50", "12:00~13:50", "14:00~15:50", "16:00~17:00"];
}
export function myeonmokSlotLabel(date, time) {
  const part = myeonmokSlots(date).indexOf(time) + 1;
  return part ? part + "부 " + time : time;
}
