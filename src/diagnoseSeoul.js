import { fetchSeoulTennisServices } from "./providers/seoulPublicProvider.js";

try {
  const catalog = await fetchSeoulTennisServices({ forceRefresh: true });
  console.log("[서울시 API] 연결 정상");
  console.log(`예약 서비스: ${catalog.totalServiceCount}건`);
  console.log(`고유 장소: ${catalog.uniquePlaceCount}곳`);
  console.log("");
  console.log("자치구:");
  for (const [areaName, count] of countBy(catalog.places, "areaName")) {
    console.log(`${areaName} ${count}곳`);
  }
  console.log("");
  console.log("상태:");
  for (const [status, count] of countBy(catalog.services, "status")) {
    console.log(`${status} ${count}건`);
  }
  console.log("");
  console.log("샘플:");
  for (const place of catalog.places.slice(0, 3)) {
    const service = place.services[0];
    console.log(`[${place.areaName}] ${place.placeName}`);
    console.log(`- 서비스: ${service?.serviceName || "-"}`);
    console.log(`- SVCID: ${service?.serviceId || "-"}`);
    console.log(`- 상태: ${service?.status || "-"}`);
  }
} catch (error) {
  console.error("[서울시 API] 연결 실패");
  console.error(error.message || "알 수 없는 오류가 발생했습니다.");
  process.exitCode = 1;
}

function countBy(items, key) {
  const counts = new Map();
  for (const item of items || []) {
    const value = item?.[key] || "미상";
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => String(a[0]).localeCompare(String(b[0]), "ko"));
}
