import { supabase } from './supabase.client.js';

const $postList  = document.getElementById('postList');
const $postEmpty = document.getElementById('postEmpty');
const $appList   = document.getElementById('appList');
const $appEmpty  = document.getElementById('appEmpty');

let currentPostId = null;
async function deletePost(postId, btn){
  if (!confirm('이 모집글을 삭제하시겠습니까? 신청·승인 내역도 함께 삭제됩니다.')) return;

  // 버튼 잠금
  const prev = btn.textContent; btn.disabled = true; btn.textContent = '삭제중…';

  // 서버에서 소유자 체크는 RLS/함수에서 수행
  const { error } = await supabase.rpc('host_delete_post', { p_post_id: postId });
  // 단순 삭제를 쓰려면: await supabase.from('daily_posts').delete().eq('id', postId);
  if (error){
    alert(error.message || '삭제에 실패했습니다.');
    btn.disabled = false; btn.textContent = prev;
    return;
  }

  // 현재 선택 글이면 신청자 영역 초기화
  if (currentPostId === postId){
    currentPostId = null;
    $appList.innerHTML = '';
    $appEmpty.hidden = false;
  }

  await loadPosts();
}
function fmt(dt){
  try{
    return new Intl.DateTimeFormat('ko-KR',{ timeZone:'Asia/Seoul',
      month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'
    }).format(new Date(dt));
  }catch{ return dt; }
}
function escapeHTML(s){ return String(s||'')
  .replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'); }

function postCardHTML(p, counts){
  const title = `${p.sport_label||'종목 미상'} · ${p.address||''}`;
  const when  = (p.start&&p.end)? `${fmt(p.start)} ~ ${fmt(p.end)}`:'';
  const c     = counts.get(p.id) || { pending:0, accepted:0 };
  const mode  = p.recruit_mode==='fcfs'?'선착순':'선발형';
  return `
    <article class="card" data-post="${p.id}">
      <h3>${escapeHTML(title)}</h3>
      <p class="meta">${escapeHTML(when)}
      </br>${mode} · 승인 ${c.accepted}명${p.capacity?` / 정원 ${p.capacity}`:''} · 대기 ${c.pending}명</p>
      <div class="row" style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" data-act="pick">신청자 보기</button>
        <button class="btn danger" data-act="delete">모집글 삭제</button>
      </div>
    </article>`;
}

function appRowHTML(a){
  const whoBase = (a.nickname && a.nickname.trim())
    ? a.nickname.trim()
    : (a.email ? a.email.split('@')[0] : '사용자');
  const who = escapeHTML(whoBase);
  const st  = a.status==='accepted'?'승인'
           : a.status==='rejected'?'거절'
           : a.status==='cancelled'?'취소':'대기';
  const ctrl = a.status==='pending'
    ? `<button class="primary" data-act="accept" data-id="${a.id}">승인</button>
       <button class="btn" data-act="reject" data-id="${a.id}">거절</button>`
    : '';
  return `
    <article class="card">
      <h3>${who}</h3>
      <p class="meta">${escapeHTML(a.email||'')} · 상태: ${st} · 신청시각 ${fmt(a.created_at)}</p>
      <p class="meta">신청메시지: ${a.message ? escapeHTML(a.message) : '—'}</p>
      <div class="row" style="display:flex;gap:8px;flex-wrap:wrap">${ctrl}</div>
    </article>`;
}

async function loadPosts(){
  const { data:{ user } } = await supabase.auth.getUser();
  if (!user){ location.href = './mypage.html'; return; }

  const { data:posts, error } = await supabase
    .from('daily_posts')
    .select('id,sport_label,address,start,end,capacity,recruit_mode')
    .eq('user_id', user.id)
    .order('start', { ascending:false });
  if (error){ console.error(error.message); return; }

  if (!posts || posts.length===0){
    $postEmpty.hidden=false; $postList.innerHTML=''; return;
  }

  const ids = posts.map(p=>p.id);
  const { data:apps } = await supabase
    .from('participation_apps')
    .select('post_id,status')
    .in('post_id', ids);

  const counts = new Map();
  (apps||[]).forEach(a=>{
    const c = counts.get(a.post_id) || { pending:0, accepted:0 };
    if (a.status==='pending')  c.pending++;
    if (a.status==='accepted') c.accepted++;
    counts.set(a.post_id, c);
  });

  $postEmpty.hidden=true;
  $postList.innerHTML = posts.map(p=>postCardHTML(p, counts)).join('');
}

async function loadApplicants(postId){
  currentPostId = postId;

  // 호스트 전용 RPC: nickname/email 포함
  const { data, error } = await supabase.rpc('list_applicants', { _post_id: postId });
  if (error){ console.error(error.message); return; }

  // 버튼 제어를 위해 app id도 필요 → 상태 테이블에서 id만 매핑
  const { data:rawApps } = await supabase
    .from('participation_apps')
    .select('id, applicant_id, status, created_at')
    .eq('post_id', postId)
    .order('created_at', { ascending:true });

  const idByApplicant = new Map((rawApps||[]).map(a=>[a.applicant_id, a.id]));

  const rows = (data||[]).map(r=>({
    id: idByApplicant.get(r.applicant_id) || null,
    applicant_id: r.applicant_id,
    nickname: r.nickname,
    email: r.email,
    status: r.status,
    message: r.message || '',
    created_at: r.created_at
  }));

  if (rows.length===0){ $appEmpty.hidden=false; $appList.innerHTML=''; return; }
  $appEmpty.hidden=true;
  $appList.innerHTML = rows.map(appRowHTML).join('');
}

async function decide(appId, newStatus){
  if (!confirm(newStatus==='accepted' ? '이 신청을 승인할까요?' : '이 신청을 거절할까요?')) return;
  const { data, error } = await supabase.rpc('host_decide_application', {
    p_app_id: appId,
    p_action: (newStatus==='accepted' ? 'accept' : 'reject')
  });
  if (error){
    const msg = String(error.message||'');
    if (/capacity full/i.test(msg)) alert('정원이 가득 찼습니다. 다른 신청을 거절하거나 정원을 늘려주세요.');
    else if (/already decided/i.test(msg)) alert('이미 처리된 신청입니다.');
    else alert(msg);
    return;
  }
  await loadApplicants(currentPostId);
  await loadPosts();
}

$postList.addEventListener('click', (e)=>{
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const postId = Number(e.target.closest('[data-post]')?.dataset.post);
  if (!Number.isFinite(postId)) return;
  if (btn.dataset.act==='pick')   loadApplicants(postId);
  if (btn.dataset.act==='delete') deletePost(postId, btn);
});

$appList.addEventListener('click', (e)=>{
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const id = Number(t.dataset.id);
  if (!Number.isFinite(id)) return;
  if (t.dataset.act==='accept') decide(id,'accepted');
  if (t.dataset.act==='reject') decide(id,'rejected');
});
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnBack')?.addEventListener('click', () => {
    if (window.history.length > 1) history.back();
    else location.href = './mypage.html';
  });
});
document.addEventListener('DOMContentLoaded', loadPosts);
