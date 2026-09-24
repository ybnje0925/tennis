import "dotenv/config";

process.env.LEGACY_HTTP_ENABLED = "true";
process.env.LEGACY_HTTP_FALLBACK = "false";
process.env.SONGPA_HTTP_ENABLED = "true";

const { checkGangdongVenues } = await import("../src/checker.js");
const { checkSongpaVenues } = await import("../src/providers/songpaProvider.js");

const date = process.argv[2] || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const venueDates = {
  gangil: [date],
  myeongil: [date],
  "songpa-oryun": [date],
  "songpa-seongnaecheon": [date],
  "songpa-songpa": [date],
  "songpa-ogeum": [date]
};

const [gangdong, songpa] = await Promise.all([
  checkGangdongVenues(["gangil", "myeongil"], { venueDates }),
  checkSongpaVenues(Object.keys(venueDates).filter((id) => id.startsWith("songpa-")), { venueDates })
]);

console.log(JSON.stringify({
  date,
  gangdong: Object.fromEntries(Object.entries(gangdong).map(([id, items]) => [id, { count: items.length, available: items.filter((item) => item.available).length }])),
  songpa: Object.fromEntries(Object.entries(songpa).map(([id, items]) => [id, { count: items.length, available: items.filter((item) => item.available).length }]))
}, null, 2));
