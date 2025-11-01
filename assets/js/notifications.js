// 알림 목록/무한 스크롤/읽음 처리/실시간 반영
import { supabase } from './supabase.client.js';

const $list     = document.getElementById('list');
const $empty    = document.getElementById('empty');
const $loader   = document.getElementById('loader');
const $sentinel = document.getElementById('sentinel');
function koStatus(s){
  switch (String(s||'').toLowerCase()){
    case 'accepted':  return '승인됨';
    case 'rejected':  return '거절됨';
    case 'cancelled': return '취소됨';
    case 'pending':   return '대기';
    default:          return String(s||'');
  }
}
//const $tabAll    = document.getElementById('tab-all');
//const $tabUnread = document.getElementById('tab-unread');
const $reloadBtn = document.getElementById('reloadBtn');
const $markAll   = document.getElementById('markAllReadBtn');
const $deleteAll = document.getElementById('deleteAllBtn');

const PAGE = 20;
let userId = null;
let filter = 'all';
let page   = 0;
let busy   = false;
let done   = false;
let channel = null;

init().catch(console.error);

async function init(){
  const { data:{ session } } = await supabase.auth.getSession();
  if (!session){ location.href = './mypage.html'; return; }
  userId = session.user.id;

  bindUI();
  await resetAndLoad();
  subscribeRealtime();
}

function bindUI(){
  document.querySelectorAll('.tabs .tab').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if (btn.getAttribute('aria-pressed') === 'true') return;
      document.querySelectorAll('.tabs .tab').forEach(b=>b.setAttribute('aria-pressed','false'));
      btn.setAttribute('aria-pressed','true');
      filter = btn.dataset.filter;
      await resetAndLoad();
    });
  });

  $reloadBtn.addEventListener('click', resetAndLoad);
  $markAll.addEventListener('click', markAllRead);
  $deleteAll.addEventListener('click', deleteAll);

  const io = new IntersectionObserver((entries)=>{
    entries.forEach(e=>{ if (e.isIntersecting) loadMore(); });
  },{rootMargin:'300px 0px'});
  io.observe($sentinel);

  $list.addEventListener('click', async (e)=>{
    const $row = e.target.closest('[data-id]');
    if (!$row) return;

    if (e.target.matches('[data-act="open"]')){
      await ensureRead($row.dataset.id);
      const url = $row.dataset.url;
      if (url) window.open(url, '_blank', 'noopener');
      return;
    }
    if (e.target.matches('[data-act="read"]')){
      await ensureRead($row.dataset.id);
      paintRowRead($row.dataset.id);
      return;
    }
    if (e.target.matches('[data-act="del"]')){
      await removeRow($row.dataset.id);
      return;
    }

    if (!$row.querySelector('[data-act]')?.contains(e.target)){
      await ensureRead($row.dataset.id);
      paintRowRead($row.dataset.id);
    }
  });
}

async function resetAndLoad(){
  page = 0; done = false;
  $list.innerHTML = '';
  $empty.hidden = true;
  await loadMore(true);
}

async function loadMore(){
  if (busy || done) return;
  busy = true; $loader.hidden = false;

  const from = page * PAGE;
  const to   = from + PAGE - 1;

  let q = supabase
    .from('notifications')
    .select('id,type,category,title,body,link,payload,created_at,read_at', { count:'exact' })
    .eq('recipient_id', userId)
    .order('created_at', { ascending:false })
    .range(from, to);

  if (filter === 'unread') q = q.is('read_at', null);
  else if (filter !== 'all') q = q.eq('category', filter);

  const { data, error, count } = await q;
  $loader.hidden = true; busy = false;

  if (error){ console.error(error); if (from===0) $empty.hidden=false; return; }
  if (!data || data.length===0){ if (from===0) $empty.hidden=false; done = true; return; }

  const frag = document.createDocumentFragment();
  data.forEach(row => frag.appendChild(renderItem(row)));
  $list.appendChild(frag);

  page += 1;
  if (count != null && $list.children.length >= count) done = true;
}

function renderItem(row){
  const el = document.createElement('div');
  el.className = 'item';
  el.setAttribute('role','listitem');
  el.dataset.id = row.id;
  const p = row.payload || {};
  if (row.link || p.link) el.dataset.url = row.link || p.link;

  const read = !!row.read_at;
  const catLabel = koCategoryLabel(row.category || 'system');

  el.innerHTML = `
    <div class="dot ${read?'read':''}" aria-hidden="true"></div>
    <div class="grow">
        <p class="ttl">${escapeHTML(makeTitle(row))}</p>
        <pre class="body">${escapeHTML(makeBody(row))}</pre>
        <div class="meta">
            <span>분류: ${escapeHTML(catLabel)}</span>
            <time datetime="${row.created_at}">${formatKST(row.created_at)}</time>
            ${read ? `<span>· 읽음</span>`:`<span>· 미읽음</span>`}
        </div>
        <div class="rowbtns">
            ${read ? '' : `<button class="pill" data-act="read">읽음</button>`}
            <button class="pill" data-act="del">삭제</button>
        </div>
    </div>
    `;
  return el;
}
/*
function badgeText(kind, severity){
  // kind 예시: 'moderation_post_removed', 'moderation_restrict', 'participation_request', 'system'
  // severity 예시: 'info'|'warning'|'critical'
  if (!kind) return '';
  const map = {
    moderation_post_removed: '게시글 삭제',
    moderation_restrict: '이용 제한',
    participation_request: '참여 요청',
    system: '시스템'
  };
  const label = map[kind] || '알림';
  if (!severity) return label;
  return `${label} · ${severity.toUpperCase()}`;
}*/

function paintRowRead(id){
  const row = $list.querySelector(`[data-id="${cssEscape(id)}"]`);
  if (!row) return;
  row.querySelector('.dot')?.classList.add('read');
  row.querySelector('[data-act="read"]')?.remove();
  row.querySelectorAll('.meta span').forEach(s=>{
    if (/미읽음/.test(s.textContent||'')) s.textContent = '· 읽음';
  });
}

async function ensureRead(id){
  const dot = $list.querySelector(`[data-id="${cssEscape(id)}"] .dot`);
  if (dot && dot.classList.contains('read')) return;

  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .eq('recipient_id', userId);
  if (!error) paintRowRead(id);
}

async function removeRow(id){
  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('id', id)
    .eq('recipient_id', userId);
  if (!error){
    $list.querySelector(`[data-id="${cssEscape(id)}"]`)?.remove();
    if ($list.children.length === 0) $empty.hidden = false;
  }
}

async function markAllRead(){
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', userId)
    .is('read_at', null);
  if (error) return;
  $list.querySelectorAll('.item').forEach(el=>{
    el.querySelector('.dot')?.classList.add('read');
    el.querySelector('[data-act="read"]')?.remove();
    el.querySelectorAll('.meta span').forEach(s=>{
      if (/미읽음/.test(s.textContent||'')) s.textContent = '· 읽음';
    });
  });
}
// 현재 탭(filter)에 맞춰 일괄 삭제: all=전체, unread=미읽음만, 그 외=해당 카테고리만
async function deleteAll(){
  if (!confirm(
    filter==='all' ? '모든 알림을 삭제할까요?'
    : filter==='unread' ? '모든 미읽음 알림을 삭제할까요?'
    : `‘${koCategoryLabel(filter)}’ 분류의 알림을 모두 삭제할까요?`
  )) return;

  let q = supabase.from('notifications').delete().eq('recipient_id', userId);
  if (filter === 'unread') q = q.is('read_at', null);
  else if (filter !== 'all') q = q.eq('category', filter);

  const { error } = await q;
  if (error){ alert(error.message||'삭제에 실패했습니다.'); return; }
  await resetAndLoad();
}

function makeTitle(row){
  const p = row.payload || {};
  if (p.kind === 'warning') return '경고 안내';
  if (p.kind === 'removed') return (p.src==='daily'?'일일참여':'커뮤니티') + ' 게시글 삭제 안내';
  if (row.title) return row.title;
  switch (row.type) {
    case 'new_application':       return '새 일일참여 신청이 도착했어요';
    case 'application_accepted':  return '일일참여 신청이 승인되었어요';
    case 'application_rejected':  return '일일참여 신청이 거절되었어요';
    case 'post_deleted':          return '게시글이 삭제되었습니다';
    default:                      return '알림';
  }
}

function makeBody(row){
  if (row.body) return row.body;
  const p = row.payload || {};
  if (p.kind === 'warning'){
    const title = p.post_title || '(제목 없음)';
    const reason = p.reason || '운영정책 위반 의심';
    return `${reason}\n제목: ${title}\n운영정책 위반 시 삭제될 수 있습니다.`;
  }
  if (p.kind === 'removed'){
    const title = p.post_title || '(제목 없음)';
    const reason = p.reason || '운영정책 위반으로 게시글이 삭제되었습니다.';
    return `${reason}\n제목: ${title}`;
  }
  switch (row.type) {
    case 'new_application': {
      const who = p.applicant_nick || (p.applicant_email ? p.applicant_email.split('@')[0] : '신청자');
      const sport = p.sport_label ? `종목: ${p.sport_label}` : '';
      const addr  = p.address ? `장소: ${p.address}` : '';
      const stat  = p.status ? `상태: ${koStatus(p.status)}` : '';
      return [ `신청자: ${who}`, sport, addr, stat ].filter(Boolean).join('\n');
    }
    case 'application_accepted': {
      const sport = p.sport_label ? `종목: ${p.sport_label}` : '';
      const addr  = p.address ? `장소: ${p.address}` : '';
      return ['참여가 확정되었습니다.', sport, addr].filter(Boolean).join('\n');
    }
    case 'application_rejected': {
      const sport = p.sport_label ? `종목: ${p.sport_label}` : '';
      const addr  = p.address ? `장소: ${p.address}` : '';
      return ['작성자로부터 참여 신청이 거절되었습니다.', sport, addr].filter(Boolean).join('\n');
    }
    case 'post_deleted': {
      const reason = p.reason || '';
      const sport  = p.sport_label ? `종목: ${p.sport_label}` : '';
      const addr   = p.address ? `장소: ${p.address}` : '';
      return [reason, sport, addr].filter(Boolean).join('\n') || '운영정책 위반으로 삭제되었습니다.';
    }
    default:
      return JSON.stringify(p, null, 2);
  }
}
function subscribeRealtime(){
  if (channel){ try { supabase.removeChannel(channel); } catch{}; channel=null; }
  channel = supabase
    .channel('notif-feed-'+userId)
    .on('postgres_changes', {
      event: 'INSERT', schema:'public', table:'notifications',
      filter: `recipient_id=eq.${userId}`
    }, payload=>{
      const row = payload.new;
      if (filter !== 'all' && filter !== 'unread' && row.category !== filter) return;
      if (filter === 'unread' && row.read_at !== null) return;
      const el = renderItem(row);
      $list.insertBefore(el, $list.firstChild||null);
      $empty.hidden = true;
    })
    .on('postgres_changes', {
      event: 'UPDATE', schema:'public', table:'notifications',
      filter: `recipient_id=eq.${userId}`
    }, ({ new:row })=>{
      const existed = $list.querySelector(`[data-id="${cssEscape(row.id)}"]`);
      if (!existed) return;
      if (row.read_at) paintRowRead(row.id);
      if (filter === 'unread' && row.read_at){ existed.remove(); if ($list.children.length===0) $empty.hidden=false; }
    })
    .on('postgres_changes', {
      event: 'DELETE', schema:'public', table:'notifications',
      filter: `recipient_id=eq.${userId}`
    }, ({ old })=>{
      $list.querySelector(`[data-id="${cssEscape(old.id)}"]`)?.remove();
      if ($list.children.length===0) $empty.hidden=false;
    })
    .subscribe();
}
function notifCard(n){
  const p = n.payload || {};
  const src = p.src === 'daily' ? '일일참여' : '커뮤니티';
  const icon = n.type === 'warning' ? '⚠️' : '🔔';
  const title = escapeHtml(p.title || '알림');
  const message = escapeHtml(p.message || '').replace(/\n/g,'<br>');
  const link = p.link ? `<a class="btn primary" href="${p.link}" target="_blank" rel="noopener">열기</a>` : '';
  const when = new Date(n.created_at||Date.now()).toLocaleString();

  return `
  <article class="notice-card">
    <div class="notice-head">
      <span class="notice-ico" aria-hidden="true">${icon}</span>
      <h3 class="notice-title">${title}</h3>
      <span class="notice-badge ${p.src==='daily'?'is-daily':'is-comm'}">${src}</span>
    </div>
    <div class="notice-body">${message}</div>
    <div class="notice-foot">
      <time class="notice-time" datetime="${n.created_at||''}">${when}</time>
      <div class="spacer"></div>
      ${link}
    </div>
  </article>`;
}
// 유틸
function escapeHTML(s){ return String(s||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'); }
function cssEscape(s){ return String(s).replace(/("|'|\\)/g, '\\$1'); }
function formatKST(iso){
  try{
    const d = new Date(iso);
    const s = new Intl.DateTimeFormat('ko-KR', {
      timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'
    }).format(d);
    return s
      .replace(/\./g, '-')
      .replace(/\s*-\s*(오전|오후)/, ' $1')
      .replace(/\s+/g, ' ')      
      .trim();
  }catch{ return iso; }
}
function koCategoryLabel(cat){
  const map = {
    notice: '공지',
    system: '시스템',
    participation: '일일참여',
    moderation: '운영'
  };
  return map[cat] ?? '알림';
}