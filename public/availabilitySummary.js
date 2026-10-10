export function facilityResultText(facility) {
  if (facility.status === "failed") return "조회 실패 · 빈자리 확인 불가";
  if (facility.status !== "checked") return "이번 주기 미조회 · 빈자리 확인 불가";
  if (facility.availableCount === 0) return "조회 완료 · 설정한 조건의 빈자리 없음";
  if (Number.isInteger(facility.availableCount) && facility.availableCount > 0) return "조회 완료 · 설정한 조건의 빈자리 " + facility.availableCount + "건 발견";
  return "조회 완료 · 빈자리 유무 확인 불가";
}
