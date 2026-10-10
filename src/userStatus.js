import { VENUES, PROVIDERS } from "./constants.js";

// Never forward shared free-text summaries: they may contain other users' dates
// or notification errors. Rebuild each entry from scoped structured details.
export function userSystemStatus(state, userId) {
  const watches = state.watches.filter(w => w.userId === userId);
  const venues = new Set(watches.flatMap(w => w.venues || []));
  const providers = new Set([...venues].map(id => VENUES[id]?.provider).filter(Boolean));
  const relevant = e => watches.some(w =>
    (e.venueId ? w.venues?.includes(e.venueId) : w.venues?.some(id => VENUES[id]?.provider === e.provider))
    && (!e.targetDate || e.targetDate === w.date));
  const logs = [], logIds = [], logDetails = [];
  for (const [index, detail] of (state.system.logDetails || []).entries()) {
    if (!detail || (detail.logId ? detail.logId !== state.system.logIds?.[index] : detail.line !== state.system.logs?.[index])) continue;
    const ownTargets = detail.watchTargets?.filter(t => t.userId === userId && watches.some(w => w.id === t.watchId));
    if (detail.watchTargets?.length && !ownTargets.length) continue;
    const checkedVenues = ownTargets?.length ? new Set(ownTargets.flatMap(t => t.venueIds || [])) : venues;
    const facilities = (detail.facilities || []).filter(f => checkedVenues.has(f.venueId));
    const errors = (detail.errors || []).filter(relevant);
    const notificationErrors = (detail.notificationErrors || []).filter(e => e.userId === userId);
    const skippedProviders = (detail.skippedProviders || []).filter(p => providers.has(p.provider));
    if (detail.kind === "provider-skip" && providers.has(detail.provider)) {
      skippedProviders.push({ provider: detail.provider, providerName: detail.providerName, reason: detail.reason });
    }
    if (!facilities.length && !errors.length && !notificationErrors.length && !skippedProviders.length) continue;
    const time = (state.system.logs?.[index] || "").match(/^\[\d{2}:\d{2}\]/)?.[0] || "";
    const labels = [...new Set([...facilities.map(f => f.provider), ...errors.map(e => e.provider), ...skippedProviders.map(p => p.provider)])]
      .map(id => PROVIDERS[id]?.name || id).filter(Boolean).join(" · ");
    const line = time + " " + (errors.length ? "조회실패" : "조회") + " | " + labels + (notificationErrors.length ? " · 내 알림 발송 실패" : "");
    logs.push(line); logIds.push(detail.logId || String(index));
    logDetails.push({ logId: logIds.at(-1), line, kind: errors.length ? "provider-error" : "provider-check", checkedAt: detail.checkedAt, facilities, errors, skippedProviders, notificationErrors });
  }
  const scopedProviders = Object.fromEntries(Object.entries(state.system.providers || {}).filter(([id]) => providers.has(id)).map(([id,p]) => {
    // Shared provider error text can mention dates belonging to other users.
    const { lastError, ...safe } = p;
    return [id, { ...safe, lastError: lastError ? "시설 조회에 문제가 있습니다. 개인 조회 로그를 확인하세요." : null }];
  }));
  return { logs, logIds, logDetails, providers: scopedProviders,
    venues: Object.fromEntries(Object.entries(state.system.venues || {}).filter(([id]) => venues.has(id)).map(([id,v]) => [id, { ...v, ...(v.lastError ? {lastError:"시설 조회 오류"} : {}) }])) };
}
