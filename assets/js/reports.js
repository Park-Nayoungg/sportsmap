import { supabase } from './supabase.client.js';
const $ = (s,r=document)=>r.querySelector(s);

let __tab = 'community'; // 현재 탭: 'community' | 'daily'

async function assertAdmin(){
  const { data:{ session } } = await supabase.auth.getSession();
  if(!session?.user){ location.href='./login.html'; return; }
  const { data:isAdm, error } = await supabase.rpc('is_admin');
  if(error || !isAdm){ alert('권한이 없습니다.'); history.back(); throw new Error('forbidden'); }
}

async function fetchReports(){
  const { data, error } = await supabase.rpc('admin_list_reports_v5', { p_limit:100, p_offset:0 });
  if(error){ alert('불러오기 실패'); throw error; }
  return data||[];
}

function card(r){
  const href = (r.src === 'daily')
    ? `./dailyprograms.html?post=${r.target_id}`
    : `./community.html?post=${r.target_id}`;

  const el = document.createElement('div');
  el.className='card';
  el.dataset.src = r.src;
  el.dataset.postId = r.target_id;

  el.innerHTML = `
    <h3 style="margin:0 0 6px">
      [${r.src==='daily'?'일일참여':'커뮤니티'}] 제목: ${r.post_title || '(없음)'}
      <span class="badge">#${r.target_id}</span>
    </h3>
    <p class="meta" style="margin:0 0 6px">
      작성자: <strong>${r.author_nickname || '(닉네임 없음)'}</strong>
      <span>${r.author_email || '-'}</span>
      <span style="opacity:.7">uuid: ${r.post_author}</span>
    </p>
    <p class="meta" style="margin:0 0 8px">${new Date(r.created_at).toLocaleString()} · 신고 사유: ${r.reason||'-'}</p>
    <div class="actions" style="display:flex;gap:8px;flex-wrap:wrap">
      <a class="btn" href="${href}" target="_blank" rel="noopener">게시글 열기</a>
      <button class="btn act-warn"  data-id="${r.target_id}" data-author="${r.post_author}" data-src="${r.src}">경고만 보내기</button>
      ${r.src==='community'
        ? `<button class="btn act-remove" data-id="${r.target_id}" data-author="${r.post_author}" data-src="community">게시글 삭제+알림</button>`
        : ``}
    </div>`;
  return el;
}

function renderLists(rows){
  const comm  = rows.filter(r=>r.src==='community');
  const daily = rows.filter(r=>r.src==='daily');
  $('#cntCommunity').textContent = String(comm.length);
  $('#cntDaily').textContent     = String(daily.length);

  const L = $('#reportList');
  const picked = (__tab==='community') ? comm : daily;
  if(!picked.length){
    L.innerHTML = '<p class="meta">신고 내역이 없습니다.</p>';
    return;
  }
  L.replaceChildren(...picked.map(card));
}

async function sendWarning(postId, authorId, src){
  const { data:isAdm } = await supabase.rpc('is_admin');
  if(!isAdm){ alert('권한이 없습니다.'); return; }

  // 제목 조회: 커뮤니티 우선, 일일참여는 대체
  let title='(제목 없음)';
  if(src==='community'){
    try{
      const { data:post } = await supabase.from('community_posts')
        .select('title').eq('id',postId).single();
      if(post?.title) title = post.title;
    }catch(_){}
  }else{
    try{
      const { data:dp } = await supabase.from('daily_posts')
        .select('sport_label,type').eq('id',postId).single();
      title = dp?.sport_label || dp?.type || title;
    }catch(_){}
  }

  const reason = prompt('경고 사유를 입력하세요','운영정책 위반 의심');
  if(reason===null) return;

  const link = (src==='daily') ? `/dailyprograms.html?post=${postId}` : `/community.html?post=${postId}`;
  const payload = {
    kind: 'warning',              // ← 템플릿 구분자
    src,                          // 'community' | 'daily'
    post_id: postId,
    post_title: title,
    link,
    reason
  };

  const { error:err2 } = await supabase.from('notifications').insert({
    recipient_id: authorId,
    type: 'warning',
    payload
  });
  if(err2){ alert('전송 실패: ' + (err2.message||'')); return; }
  alert('경고를 보냈습니다.');
}

async function removeWithNotice(postId, _authorId){
  const reason = prompt('삭제 사유를 입력하세요','욕설/비방 등 운영정책 위반');
  if(reason===null) return;
  const { error } = await supabase.rpc('admin_remove_post', { p_post_id: postId, p_reason: reason });
  if(error){ alert(error.message||'삭제 실패'); return; }
  // 삭제 알림 발송
  await supabase.from('notifications').insert({
    recipient_id: _authorId,
    type: 'removed',
    payload: {
      kind: 'removed',
      src: 'community',
      post_id: postId,
      post_title: '(제목 없음)',   // 필요 시 제목 조회해 채우세요
      link: `/community.html?post=${postId}`,
      reason
    }
  });
  alert('삭제 및 알림 완료');
  location.reload();
}

document.addEventListener('DOMContentLoaded', async ()=>{
  await assertAdmin();

  const rows = await fetchReports();
  renderLists(rows);

  // 뒤로가기
  $('#btnBack')?.addEventListener('click', ()=> history.back());

  // 탭 전환
  $('.tabs')?.addEventListener('click', (e)=>{
    const t = e.target.closest('.tab'); if(!t) return;
    __tab = t.dataset.tab;
    document.querySelectorAll('.tab').forEach(b=>{
      const on = (b===t);
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on?'true':'false');
    });
    renderLists(rows);
  });

  // 리스트 내 버튼 동작
  $('#reportList').addEventListener('click', async (e)=>{
    const b = e.target.closest('button'); if(!b) return;
    const id = Number(b.dataset.id);
    const author = b.dataset.author;
    const src = b.dataset.src;
    if(b.classList.contains('act-warn'))  await sendWarning(id, author, src);
    if(b.classList.contains('act-remove') && src==='community') await removeWithNotice(id, author);
  });
});
