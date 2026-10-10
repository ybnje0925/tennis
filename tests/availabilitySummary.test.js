import { expect, it } from "vitest";
import { facilityResultText } from "../public/availabilitySummary.js";
import { cycleLogDetails } from "../src/monitor.js";
import { userSystemStatus } from "../src/userStatus.js";
const watches = [
  {id:"a",userId:"a",venues:["gangil"],date:"2099-10-11",times:["06:00~08:00"],enabled:true},
  {id:"b",userId:"b",venues:["gangil"],date:"2099-10-11",times:["20:00~22:00"],enabled:true}
];
const checked = { gangil: [
  {venue:"gangil",date:"2099-10-11",time:"06:00~08:00",available:false},
  {venue:"gangil",date:"2099-10-11",time:"20:00~22:00",available:true}
]};
function payload(detail, userId) {
  return userSystemStatus({watches,system:{logs:["[17:20] 강동"],logIds:["test"],logDetails:[{...detail,line:"[17:20] 강동",logId:"test"}]}},userId);
}
it("counts available matches for each user rather than all fetched rows",()=>{
  const detail=cycleLogDetails({checked,watches,activeVenueIds:["gangil"],checkedAt:"2099-10-10T08:20:00Z"});
  expect(detail.userResults).toEqual([{userId:"a",venueId:"gangil",availableCount:0},{userId:"b",venueId:"gangil",availableCount:1}]);
  expect(payload(detail,"a").logs[0]).toContain("조회 완료 · 빈자리 없음");
  expect(payload(detail,"a").logDetails[0].facilities[0].resultMessage).toBe("조회 완료 · 설정한 조건의 빈자리 없음");
  expect(payload(detail,"b").logs[0]).toContain("빈자리 1건 발견");
  expect(payload(detail,"a")).not.toHaveProperty("userResults");
});
it("reports failure as unknown even when the provider returns an empty array",()=>{
  const result={gangil:[]};
  Object.defineProperty(result,Symbol.for("tennis.checkMeta"),{value:{errors:[{provider:"gangdong",venueId:"gangil",targetDate:"2099-10-11",type:"TIMEOUT"}]}});
  const detail=cycleLogDetails({checked:result,watches,activeVenueIds:["gangil"]});
  expect(detail.userResults.every(r=>r.availableCount===null)).toBe(true);
  const status=payload(detail,"a");
  expect(status.logs[0]).toContain("조회 실패 · 빈자리 확인 불가");
  expect(status.logs[0]).not.toContain("빈자리 없음");
});
it("distinguishes unqueried facilities and legacy unknown counts from no vacancy",()=>{
  expect(facilityResultText({status:"not-due",availableCount:0})).toContain("미조회 · 빈자리 확인 불가");
  expect(facilityResultText({status:"failed",availableCount:0})).toContain("조회 실패");
  const status=payload({facilities:[{venueId:"gangil",provider:"gangdong",status:"checked",count:20}]},"a");
  expect(status.logDetails[0].facilities[0].availableCount).toBe(null);
  expect(status.logs[0]).toContain("확인 불가");
  expect(payload({facilities:[{venueId:"gangil",provider:"gangdong",status:"checked",count:0}]},"a").logs[0]).toContain("확인 불가");
});
