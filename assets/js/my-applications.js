import { supabase } from './supabase.client.js';

const $list = document.getElementById('appList');
const $empty = document.getElementById('appEmpty');

function fmt(dt){
  try{ return new Intl.DateTimeFormat('ko-KR',{
    timeZone:'Asia/Seoul', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'
  }).format(new Date(dt)); }catch{ return dt; }
}

function rowHTML(r){
  const p = r.post || {};
  const title = `${p.sport_label||'종목 미상'} · ${p.address||''}`;
  const when  = (p.start && p.end) ? `${fmt(p.start)} ~ ${fmt(p.end)}` : '';
  const badge = r.status==='accepted'?'승인'
              : r.status==='pending' ? '대기'
              : r.status==='rejected'? '거절' : '취소';
  return `
    <article class="card">
      <h3>${title}</h3>
      <p class="meta">${when}</p>
      <p class="meta">상태: ${badge}</p>
      <div class="row" style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn" href="./dailyprograms.html">목록으로</a>
      </div>
    </article>`;
}

async function load(){
  const { data:{ user } } = await supabase.auth.getUser();
  if (!user){ location.href = './mypage.html'; return; }
  const { data, error } = await supabase
    .from('participation_apps')
    .select('id,status,created_at, post:daily_posts(id,sport_label,address,start,end,user_id)')
    .eq('applicant_id', user.id)
    .order('created_at', { ascending:false });
  if (error){ console.error(error.message); return; }

  if (!data || data.length===0){ $empty.hidden=false; $list.innerHTML=''; return; }
  $empty.hidden = true;
  $list.innerHTML = data.map(rowHTML).join('');
}
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnBack')?.addEventListener('click', () => {
    if (window.history.length > 1) history.back();
    else location.href = './mypage.html';
  });
});
document.addEventListener('DOMContentLoaded', load);
