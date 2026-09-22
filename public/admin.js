const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = value => value ? new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}) : '기록 없음';
let token = '', data = null, requestVersion = 0;
const eventNames = {watch_created:'알림 생성',watch_deleted:'알림 삭제',watch_enabled:'알림 켜기',watch_disabled:'알림 끄기',telegram_sent:'발송 성공',telegram_failed:'발송 실패'};
async function copyText(value) {
  if (!navigator.clipboard?.writeText) return false;
  try { await navigator.clipboard.writeText(value); return true; } catch { return false; }
}
async function load() {
  const version = ++requestVersion;
  $('message').textContent = '불러오는 중…';
  $('refresh').disabled = true;
  try {
    const response = await fetch('/api/admin/dashboard?days='+$('days').value,{headers:{'x-admin-token':token},cache:'no-store'});
    const body = await response.json();
    if (version !== requestVersion) return;
    if (!response.ok) { if(response.status===403) lock(); throw Error(body.error || '통계를 불러오지 못했습니다.'); }
    data=body; $('login').hidden=true; $('dashboard').hidden=false; $('message').textContent='';
    $('token').value=''; $('detail').hidden=true; render();
  } catch(error) { if(version === requestVersion || !token) $('message').textContent=error.message; }
  finally { if(version === requestVersion) $('refresh').disabled=false; }
}
function lock(){ ++requestVersion; token='';data=null;$('dashboard').hidden=true;$('login').hidden=false;$('token').value='';$('users').replaceChildren();$('detailBody').replaceChildren();$('message').textContent='';$('refresh').disabled=false; }
async function generateInvite() {
  const button = $('generateInvite');
  button.disabled = true;
  $('inviteMessage').textContent = '발급 중…';
  try {
    const response = await fetch('/api/admin/invites', { method: 'POST', headers: { 'x-admin-token': token } });
    const body = await response.json();
    if (!response.ok) throw Error(body.error || '초대코드를 발급하지 못했습니다.');
    $('inviteCode').textContent = body.code;
    $('inviteCode').hidden = false;
    $('copyInvite').hidden = false;
    $('inviteMessage').textContent = '새 초대코드가 발급되었습니다.';
    await copyText(body.code);
    await load();
  } catch (error) { $('inviteMessage').textContent = error.message; }
  finally { button.disabled = false; }
}
function render(){
  const s=data.summary;
  $('updated').textContent='갱신 '+date(data.generatedAt);
  $('coverage').textContent=`수집 시작: ${date(data.startedAt)} · 이전 방문·삭제·발송 기록은 복원되지 않습니다. 기간 통계는 수집 시작 이후만 포함하며, 사용자·활성 알림은 현재 상태입니다.`;
  $('cards').innerHTML=[['전체 사용자',s.users,'현재 가입자'],['활성 알림',s.activeWatches,'현재 · 지난 날짜 제외'],['방문 횟수',s.visits,`선택 기간 · 페이지 조회 ${s.pageViews}`],['텔레그램 발송',s.sent,`선택 기간 · 실패 ${s.failed}`]].map(([title,value,note])=>`<div class="card"><span>${title}</span><strong>${value}</strong><span>${note}</span></div>`).join('');
  $('funnel').innerHTML=[['발급 / 사용 코드',`${s.invites} / ${s.usedInvites}`],['가입자',s.users],['텔레그램 연결',s.connected],['활성 알림 보유자',s.activeUsers]].map(([t,n])=>`<div>${t}<strong>${n}</strong></div>`).join('');
  renderUsers(); renderHours();
  const max=Math.max(1,...data.venues.map(v=>v.users));
  $('venues').innerHTML=data.venues.map(v=>`<div class="venue"><div class="venue-top"><b>${escape(v.name)}</b><span>${v.users}명 · ${v.watches}개 · 발송 ${v.sent}회</span></div><div class="bar"><i style="width:${v.users/max*100}%"></i></div></div>`).join('');
  $('daily').innerHTML=data.daily.slice().reverse().map(d=>`<tr><td>${d.date}</td><td>${d.visits}</td><td>${d.created}</td><td>${d.sent}</td><td>${d.failed}</td></tr>`).join('');
}
const venueName=id=>data.venues.find(v=>v.id===id)?.name || id;
function renderUsers(){
  const q=$('search').value.trim().toLowerCase();
  const users=data.users.filter(u=>(u.name+' '+u.id).toLowerCase().includes(q));
  $('users').innerHTML=users.map(u=>{
    const ranked={}; u.watches.forEach(w=>(w.venues || []).forEach(v=>ranked[v]=(ranked[v]||0)+1));
    const top=Object.entries(ranked).sort((a,b)=>b[1]-a[1]).slice(0,2).map(([id])=>venueName(id)).join(', ') || '—';
    return `<tr><td><button class="name" data-user="${escape(u.id)}">${escape(u.name)}</button><span class="sub">${escape(date(u.createdAt))}${u.enabled?'':' · 비활성'}</span></td><td>${u.telegramConnected?'연결 완료':'미연결'}</td><td>${u.activeWatches}</td><td>${u.created} / ${u.deleted}</td><td>${u.visits}회 / ${u.visitDays}일</td><td>${u.pageViews}</td><td>${u.sent} / ${u.failed}</td><td>${escape(date(u.lastVisit))}</td><td>${escape(top)}</td></tr>`;
  }).join('') || '<tr><td colspan="9">표시할 사용자가 없습니다.</td></tr>';
}
function renderHours(){const key=$('hourMetric').value;const max=Math.max(1,...data.hours.map(h=>h[key]));$('hours').innerHTML=data.hours.map(h=>`<div class="hour" style="background:rgba(117,152,83,${.08+h[key]/max*.45})">${String(h.hour).padStart(2,'0')}시<strong>${h[key]}</strong></div>`).join('');}
$('users').addEventListener('click',e=>{
  const id=e.target.closest('[data-user]')?.dataset.user;if(!id)return;
  const u=data.users.find(u=>u.id===id); $('detail').hidden=false;$('detailTitle').textContent=u.name+' · 이용 상세';
  $('detailBody').innerHTML=`<p class="muted">사용자 ID: ${escape(u.id)} · 코드 사용: ${escape(date(u.inviteUsedAt))}</p><h3>현재 보관된 알림</h3><div class="table-wrap"><table><thead><tr><th>테니스장</th><th>날짜</th><th>시간</th><th>설정</th></tr></thead><tbody>${u.watches.map(w=>`<tr><td>${escape((w.venues||[]).map(venueName).join(', '))}</td><td>${escape(w.date)}</td><td>${escape((w.times||[]).join(', '))}</td><td>${w.enabled?'켜짐':'꺼짐'}</td></tr>`).join('') || '<tr><td colspan="4">등록된 알림이 없습니다.</td></tr>'}</tbody></table></div><h3>기간 내 최근 이력 (최대 100건)</h3><div class="table-wrap"><table><thead><tr><th>시각</th><th>활동</th><th>테니스장</th></tr></thead><tbody>${u.events.map(e=>`<tr><td>${escape(date(e.at))}</td><td>${escape(eventNames[e.type]||e.type)}</td><td>${escape((e.venues||[]).map(venueName).join(', '))}</td></tr>`).join('') || '<tr><td colspan="3">수집된 이력이 없습니다.</td></tr>'}</tbody></table></div>`;
  $('detail').scrollIntoView({behavior:'smooth',block:'start'});
});
$('loginForm').addEventListener('submit',e=>{e.preventDefault();token=$('token').value.trim();load();});
$('refresh').addEventListener('click',load);$('days').addEventListener('change',load);$('logout').addEventListener('click',lock);
$('search').addEventListener('input',()=>data&&renderUsers());$('hourMetric').addEventListener('change',()=>data&&renderHours());$('closeDetail').addEventListener('click',()=>$('detail').hidden=true);
$('generateInvite').addEventListener('click', generateInvite);
$('copyInvite').addEventListener('click', async () => {
  const copied = await copyText($('inviteCode').textContent);
  $('inviteMessage').textContent = copied ? '초대코드를 복사했습니다.' : '초대코드를 선택해 복사해주세요.';
});
