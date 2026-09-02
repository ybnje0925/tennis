import { config } from "./config.js";

export const VENUES = {
  gangil: {
    id: "gangil",
    name: "강일테니스장",
    url: "https://gdgd.igangdong.or.kr/page/rent/s01.od.list.php",
    publicUrl: "https://gdgd.igangdong.or.kr/page/rent/s01.od.list.php",
    provider: "gangdong",
    slotMinutes: 120
  },
  myeongil: {
    id: "myeongil",
    name: "명일테니스장",
    url: "https://gdgd.igangdong.or.kr/page/rent/s02.od.list.php",
    publicUrl: "https://gdgd.igangdong.or.kr/page/rent/s02.od.list.php",
    provider: "gangdong",
    slotMinutes: 120
  },
  "songpa-oryun": {
    id: "songpa-oryun",
    name: "오륜테니스장",
    url: "https://spc.esongpa.or.kr/page/rent/s04.od.list.php",
    publicUrl: "https://spc.esongpa.or.kr/page/rent/s04.od.list.php",
    provider: "songpa",
    slotMinutes: 120
  },
  "songpa-seongnaecheon": {
    id: "songpa-seongnaecheon",
    name: "성내천테니스장",
    url: "https://spc.esongpa.or.kr/page/rent/s06.od.list.php",
    publicUrl: "https://spc.esongpa.or.kr/page/rent/s06.od.list.php",
    provider: "songpa",
    slotMinutes: 120
  },
  "songpa-songpa": {
    id: "songpa-songpa",
    name: "송파테니스장",
    url: "https://spc.esongpa.or.kr/page/rent/s05.od.list.php",
    publicUrl: "https://spc.esongpa.or.kr/page/rent/s05.od.list.php",
    provider: "songpa",
    slotMinutes: 120
  },
  "songpa-ogeum": {
    id: "songpa-ogeum",
    name: "오금공원테니스장",
    url: "https://spc.esongpa.or.kr/page/rent/s03.od.list.php",
    publicUrl: "https://spc.esongpa.or.kr/page/rent/s03.od.list.php",
    provider: "songpa",
    slotMinutes: 120
  },
  olympic: {
    id: "olympic",
    name: "올림픽공원 테니스장",
    url: "https://www.ksponco.or.kr/online/tennis/index.do",
    publicUrl: "https://www.ksponco.or.kr/online/tennis/index.do",
    provider: "olympic",
    slotMinutes: 60
  },
  "hanam-tennis-1": {
    id: "hanam-tennis-1",
    name: "하남 제1테니스장",
    url: "https://rent.hanamsport.or.kr/hanam_rent_ms/",
    publicUrl: "https://rent.hanamsport.or.kr/hanam_rent_ms/",
    provider: "hanam",
    slotMinutes: 60,
    placeCode: "024"
  },
  "hanam-tennis-2": {
    id: "hanam-tennis-2",
    name: "하남 제2테니스장",
    url: "https://rent.hanamsport.or.kr/hanam_rent_ms/",
    publicUrl: "https://rent.hanamsport.or.kr/hanam_rent_ms/",
    provider: "hanam",
    slotMinutes: 60,
    placeCode: "025"
  },
  "misa-all": {
    id: "misa-all",
    name: "미사한강공원 테니스장 전체 코트",
    url: "https://www.hanam.go.kr/www/selectMisaParkResveWeb.do?key=7465&searchCategoryCode=B1",
    publicUrl: "https://www.hanam.go.kr/www/selectMisaParkResveWeb.do?key=7465&searchCategoryCode=B1",
    provider: "hanam",
    slotMinutes: 120,
    misaCourt: "ALL"
  },
  "misa-court-1": {
    id: "misa-court-1",
    name: "미사한강공원 테니스장 1코트",
    url: "https://www.hanam.go.kr/www/selectMisaParkResveWeb.do?key=7465&searchCategoryCode=B1",
    publicUrl: "https://www.hanam.go.kr/www/selectMisaParkResveWeb.do?key=7465&searchCategoryCode=B1",
    provider: "hanam",
    slotMinutes: 120,
    misaCourt: "1"
  },
  "misa-court-2": {
    id: "misa-court-2",
    name: "미사한강공원 테니스장 2코트",
    url: "https://www.hanam.go.kr/www/selectMisaParkResveWeb.do?key=7465&searchCategoryCode=B1",
    publicUrl: "https://www.hanam.go.kr/www/selectMisaParkResveWeb.do?key=7465&searchCategoryCode=B1",
    provider: "hanam",
    slotMinutes: 120,
    misaCourt: "2"
  },
  "misa-court-3": {
    id: "misa-court-3",
    name: "미사한강공원 테니스장 3코트",
    url: "https://www.hanam.go.kr/www/selectMisaParkResveWeb.do?key=7465&searchCategoryCode=B1",
    publicUrl: "https://www.hanam.go.kr/www/selectMisaParkResveWeb.do?key=7465&searchCategoryCode=B1",
    provider: "hanam",
    slotMinutes: 120,
    misaCourt: "3"
  },
  "misa-court-4": {
    id: "misa-court-4",
    name: "미사한강공원 테니스장 4코트",
    url: "https://www.hanam.go.kr/www/selectMisaParkResveWeb.do?key=7465&searchCategoryCode=B1",
    publicUrl: "https://www.hanam.go.kr/www/selectMisaParkResveWeb.do?key=7465&searchCategoryCode=B1",
    provider: "hanam",
    slotMinutes: 120,
    misaCourt: "4"
  }
};

export const LOGIN_URL = "https://gdgd.igangdong.or.kr/bbs/login.php";
export const SONGPA_LOGIN_URL = "https://spc.esongpa.or.kr/bbs/login.php";
export const OLYMPIC_HOME_URL = "https://www.ksponco.or.kr/online/tennis/index.do";
export const OLYMPIC_RESERVATION_URL = "https://www.ksponco.or.kr/online/tennis/resrvtn_aplictn.do";

export const PROVIDERS = {
  gangdong: {
    id: "gangdong",
    name: "강동구 테니스장",
    slotMinutes: 120,
    pollingMinutes: config.providerPollingMinutes.gangdong,
    publicUrl: "https://gdgd.igangdong.or.kr/",
    supportsCourtNumber: false,
    supportsContinuousSlots: false,
    venues: ["gangil", "myeongil"]
  },
  olympic: {
    id: "olympic",
    name: "올림픽공원 테니스장",
    slotMinutes: 60,
    pollingMinutes: config.providerPollingMinutes.olympic,
    monitoringHours: {
      start: "09:00",
      end: "24:00"
    },
    publicUrl: "https://www.ksponco.or.kr/online/tennis/index.do",
    supportsCourtNumber: true,
    supportsContinuousSlots: false,
    courtTypes: ["indoor", "outdoor"]
  },
  songpa: {
    id: "songpa",
    name: "송파구시설관리공단",
    slotMinutes: 120,
    pollingMinutes: config.providerPollingMinutes.songpa,
    publicUrl: "https://spc.esongpa.or.kr/",
    supportsCourtNumber: false,
    supportsContinuousSlots: false,
    venues: ["songpa-oryun", "songpa-seongnaecheon", "songpa-songpa", "songpa-ogeum"]
  },
  hanam: {
    id: "hanam",
    name: "하남시 테니스장",
    slotMinutes: 60,
    pollingMinutes: config.providerPollingMinutes.hanam ?? 5,
    publicUrl: "https://rent.hanamsport.or.kr/hanam_rent_ms/",
    supportsCourtNumber: true,
    supportsContinuousSlots: false,
    venues: ["hanam-tennis-1", "hanam-tennis-2", "misa-all", "misa-court-1", "misa-court-2", "misa-court-3", "misa-court-4"]
  }
};

export const TIME_SLOTS = [
  "06:00~08:00",
  "08:00~10:00",
  "10:00~12:00",
  "12:00~14:00",
  "14:00~16:00",
  "16:00~18:00",
  "18:00~20:00",
  "20:00~22:00"
];

export const OLYMPIC_TIME_SLOTS = [
  "06:00~07:00",
  "07:00~08:00",
  "08:00~09:00",
  "09:00~10:00",
  "10:00~11:00",
  "11:00~12:00",
  "12:00~13:00",
  "13:00~14:00",
  "14:00~15:00",
  "15:00~16:00",
  "16:00~17:00",
  "17:00~18:00",
  "18:00~19:00",
  "19:00~20:00",
  "20:00~21:00",
  "21:00~22:00"
];

export const ONE_HOUR_TIME_SLOTS = OLYMPIC_TIME_SLOTS;
