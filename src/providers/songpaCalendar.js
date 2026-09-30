import { VENUES, TIME_SLOTS } from "../constants.js";
import { diagnosticError } from "../diagnostics.js";
import { reservationKey } from "../normalization.js";

const clean = value => String(value || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim();
const error = (venueId,message) => diagnosticError({type:"PARSE_FAILED",stage:"PARSE",provider:"songpa",venueId,retryable:false,message});
export function parseSongpaSlotText(text) {
  const normalized=String(text || "").replace(/\s+/g,"");
  const match=normalized.match(/^(\d{1,2}:\d{2})~(\d{1,2}:\d{2})(예약가능|예약완료|예약불가|접수불가|휴장|미오픈)(?:\((\d+)\/(\d+)\))?$/);
  if(!match)return null;
  const reservedCount=match[4]==null?null:Number(match[4]);
  const totalCount=match[5]==null?null:Number(match[5]);
  if(totalCount!==null && (totalCount<=0 || reservedCount>totalCount))return null;
  const minutes=value=>{const [h,m]=value.split(":").map(Number);return h<=24 && m<60 && (h!==24 || m===0)?h*60+m:NaN;};
  if(!Number.isFinite(minutes(match[1])) || !Number.isFinite(minutes(match[2])) || minutes(match[2])<=minutes(match[1]))return null;
  const available=match[3]==="예약가능" && (totalCount==null || reservedCount<totalCount);
  return {startTime:match[1].padStart(5,"0"),endTime:match[2].padStart(5,"0"),
    status:match[3],available,availableCount:available && totalCount!==null?totalCount-reservedCount:undefined,
    reservedCount,totalCount};
}
export function parseSongpaCalendarSnapshot(snapshot,venueId) {
  const venue=VENUES[venueId];
  if(!venue)throw Error("Unknown venue: "+venueId);
  const year=String(snapshot.year || ""),month=String(snapshot.month || "").padStart(2,"0");
  if(!/^20\d{2}$/.test(year) || !/^(0[1-9]|1[0-2])$/.test(month))throw error(venueId,venue.name+" 달력 연월을 읽지 못했습니다.");
  const results=[],dates=new Set();
  for(const cell of snapshot.cells || []) {
    const day=String(cell.day || cell.text?.match(/^([0-3]?\d)\b/)?.[1] || "");
    if(!day)continue;
    const date=year+"-"+month+"-"+day.padStart(2,"0");
    const parsedDate=new Date(date+"T00:00:00Z");
    if(!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0,10)!==date)throw error(venueId,"송파 날짜 셀 형식이 잘못되었습니다.");
    dates.add(date);
    let hasTimes=false,dayStatus=null;
    for(const slot of cell.slots || []) {
      const text=clean(slot.text);
      if(!/\d{1,2}:\d{2}\s*~/.test(text)){
        if (/예약가능|예약완료/.test(text)) throw error(venueId, venue.name + " 예약 회차의 이용시간이 누락되었습니다.");
        if(/^(예약불가|접수불가|휴장|미오픈)$/.test(text))dayStatus=text;
        continue; // Holiday/event labels and empty cells do not prove availability.
      }
      hasTimes=true;
      const parsed=parseSongpaSlotText(text);
      if(!parsed)throw error(venueId,venue.name+" 회차 상태를 읽지 못했습니다: "+text);
      results.push(item(venue,date,parsed,text));
    }
    if(!hasTimes && dayStatus)for(const time of TIME_SLOTS){
      const [startTime,endTime]=time.split("~");
      results.push(item(venue,date,{startTime,endTime,available:false,status:dayStatus,availableCount:undefined},dayStatus));
    }
  }
  if(!dates.size)throw error(venueId,venue.name+" 달력 날짜 셀을 찾지 못했습니다.");
  const items=Array.from(new Map(results.map(x=>[reservationKey(x),x])).values()).sort((a,b)=>(a.date+a.startTime).localeCompare(b.date+b.startTime));
  Object.defineProperty(items,"calendarDates",{value:Array.from(dates),enumerable:false});
  Object.defineProperty(items,"calendarMonth",{value:year+"-"+month,enumerable:false});
  return items;
}
function item(venue,date,parsed,rawStatus){
  const minutes=value=>Number(value.slice(0,2))*60+Number(value.slice(3));
  return {provider:"songpa",venue:venue.id,venueName:venue.name,date,time:parsed.startTime+"~"+parsed.endTime,
    ...parsed,durationMinutes:minutes(parsed.endTime)-minutes(parsed.startTime),rawStatus};
}
export function parseSongpaCalendarHtml(html,venueId){
  const header=String(html).match(/<div\s+class=['"]calendar1_yearmonth['"][^>]*>([\s\S]*?)<\/div>/)?.[1] || "";
  const ym=clean(header).match(/(20\d{2})\s*\.\s*(\d{1,2})/);
  const calendar=String(html).match(/<div\s+class=['"]calendar1_table['"][^>]*>([\s\S]*?)(?=<div class=["']btnarea|<div class=["']anker-wrap|$)/)?.[1] || "";
  const cells=[...calendar.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell=>({
    day:clean(cell[1].match(/<h6\b[^>]*>([\s\S]*?)<\/h6>/i)?.[1]),text:clean(cell[1]),
    slots:[...cell[1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(li=>({text:clean(li[1])}))
  }));
  return parseSongpaCalendarSnapshot({year:ym?.[1],month:ym?.[2],cells},venueId);
}
