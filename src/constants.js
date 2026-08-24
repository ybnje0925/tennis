export const VENUES = {
  gangil: {
    id: "gangil",
    name: "강일테니스장",
    url: "https://gdgd.igangdong.or.kr/page/rent/s01.od.list.php",
    provider: "gangdong",
    slotMinutes: 120
  },
  myeongil: {
    id: "myeongil",
    name: "명일테니스장",
    url: "https://gdgd.igangdong.or.kr/page/rent/s02.od.list.php",
    provider: "gangdong",
    slotMinutes: 120
  },
  "songpa-oryun": {
    id: "songpa-oryun",
    name: "오륜테니스장",
    url: "https://spc.esongpa.or.kr/page/rent/s04.od.list.php",
    provider: "songpa",
    slotMinutes: 120
  },
  "songpa-seongnaecheon": {
    id: "songpa-seongnaecheon",
    name: "성내천테니스장",
    url: "https://spc.esongpa.or.kr/page/rent/s06.od.list.php",
    provider: "songpa",
    slotMinutes: 120
  },
  "songpa-songpa": {
    id: "songpa-songpa",
    name: "송파테니스장",
    url: "https://spc.esongpa.or.kr/page/rent/s05.od.list.php",
    provider: "songpa",
    slotMinutes: 120
  },
  "songpa-ogeum": {
    id: "songpa-ogeum",
    name: "오금공원테니스장",
    url: "https://spc.esongpa.or.kr/page/rent/s03.od.list.php",
    provider: "songpa",
    slotMinutes: 120
  },
  olympic: {
    id: "olympic",
    name: "올림픽공원 테니스장",
    url: "https://www.ksponco.or.kr/online/tennis/resrvtn_aplictn.do",
    provider: "olympic",
    slotMinutes: 60
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
    pollingMinutes: 10,
    supportsCourtNumber: false,
    supportsContinuousSlots: false,
    venues: ["gangil", "myeongil"]
  },
  olympic: {
    id: "olympic",
    name: "올림픽공원 테니스장",
    slotMinutes: 60,
    pollingMinutes: 10,
    supportsCourtNumber: true,
    supportsContinuousSlots: false,
    courtTypes: ["indoor", "outdoor"]
  },
  songpa: {
    id: "songpa",
    name: "송파구시설관리공단",
    slotMinutes: 120,
    pollingMinutes: 10,
    supportsCourtNumber: false,
    supportsContinuousSlots: false,
    venues: ["songpa-oryun", "songpa-seongnaecheon", "songpa-songpa", "songpa-ogeum"]
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
