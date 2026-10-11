import { config } from './config.js';
import { nowonAuth } from './providers/nowonAuth.js';
import { NOWON_FACILITIES } from '../public/nowonRules.js';
import { NOWON_TIMETABLE_VERIFIED } from './providers/nowonProvider.js';

// Read-only diagnosis. No reservations, Telegram messages, account values,
// response bodies, cookies, CSRF values or raw redirect URLs are printed.
if (!config.nowonUsername || !config.nowonPassword) {
  console.log('노원: 로그인 설정 필요 (NOWON_USERNAME / NOWON_PASSWORD)');
} else {
  try {
    if (process.argv.includes('--resume-auth')) {
      await nowonAuth.resume();
      console.log('운영자 요청으로 인증 중단 기록을 해제했습니다.');
    }
    await nowonAuth.ensureLogin();
    console.log('노원: 로그인 결과 0 및 로그아웃 링크 확인');
    for (const [id, facility] of Object.entries(NOWON_FACILITIES)) {
      const page = await nowonAuth.get(`/sports/courtReserve_date?cate1=1&cate2=${facility.cate2}`);
      const scripts = [...page.html.matchAll(/<script\b[^>]*src=["']([^"']+)["']/gi)].map(match => {
        const url = new URL(match[1], 'https://reservation.nowonsc.kr');
        return url.origin === 'https://reservation.nowonsc.kr' ? url.pathname.replace(/;jsessionid=[^/;?]*/gi, ';jsessionid=[REDACTED]') : null;
      }).filter(Boolean);
      console.log(`${id}: 인증된 페이지 수신 / 스크립트 경로 ${JSON.stringify(scripts)}`);
    }
    console.log(NOWON_TIMETABLE_VERIFIED ? '상세 시간표 파서: 검증됨' : '상세 시간표 파서: 미검증 / 빈자리 알림 중단');
  } catch (error) {
    console.error(`노원 진단 중단: ${error.type || 'UNKNOWN_ERROR'} / ${error.type ? error.message : '인증 또는 조회 처리 오류'}`);
    process.exitCode = 1;
  }
}
