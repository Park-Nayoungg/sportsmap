// 커뮤니티 기본 틀
import { supabase } from './supabase.client.js';

const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const esc = (t='') => String(t).replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m]));
const params   = new URLSearchParams(location.search);
const facility = params.get('facility'); 
const qType    = params.get('type');      
let currentQuery = params.get('q') || '';
let currentCategory = '전체';
const TYPE_TO_CAT = new Map([['review','후기'],['event','이벤트']]);
if (qType && TYPE_TO_CAT.get(qType)) currentCategory = TYPE_TO_CAT.get(qType);
const input = document.querySelector('header .search input[type="search"]');
if (input) input.value = currentQuery;

const FEED_LIMIT = 10;
let paging = { from: 0, loading: false, done: false };
let me = null;

/* ===== 더보기(⋮) 팝업 ===== */
let __moreMenu = null;

function ensureMoreMenu(){
  if (__moreMenu) return __moreMenu;
  const m = document.createElement('div');
  m.className = 'more-menu';
  m.hidden = true;
  m.innerHTML = `
    <button type="button" class="mm-item mm-report">신고하기</button>
    <button type="button" class="mm-item mm-remove admin-only" hidden>관리자 삭제</button>
  `;
  document.body.appendChild(m);
  __moreMenu = m;
  // 전역 클릭
  document.addEventListener('click', (e)=>{
    if (!__moreMenu || __moreMenu.hidden) return;
    if (!e.target.closest('.more-menu, .more-btn')) closeMoreMenu();
  });
  // ESC
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeMoreMenu(); });
  // 항목 클릭
  __moreMenu.addEventListener('click', async (e)=>{
    const btn = e.target.closest('.mm-item'); if(!btn) return;
    const postId = Number(__moreMenu.dataset.postId||'0');
    closeMoreMenu();
    if(btn.classList.contains('mm-report')) reportPost(postId);
    if(btn.classList.contains('mm-remove')){
      const { data:isAdm } = await supabase.rpc('is_admin');
      if(!isAdm){ alert('권한이 없습니다.'); return; }
      const reason = prompt('삭제 사유','운영정책 위반');
      if(reason!==null){
        const { error } = await supabase.rpc('admin_remove_post', { p_post_id: postId, p_reason: reason });
        if(error) alert('실패: '+(error.message||'')); else alert('삭제 완료');
      }
    }
  });
  return m;
}
async function openMoreMenu(anchor){
  const host = anchor.closest('.post'); if(!host) return;
  const pid = Number(host.dataset.postId||'0');
  const m = ensureMoreMenu(); 
  const r = anchor.getBoundingClientRect();

  m.dataset.postId = String(pid);

  // 관리자 체크: is_admin()은 인자 없음
  const { data:isAdm, error } = await supabase.rpc('is_admin');
  m.querySelector('.mm-remove').hidden = !isAdm;

  // 위치 정렬: 버튼 오른쪽 끝 기준
  m.hidden = false;
  m.style.top  = Math.round(window.scrollY + r.bottom + 6) + 'px';
  m.style.left = Math.round(window.scrollX + r.right) + 'px';
  m.style.transform = 'translateX(-100%)';
}

function closeMoreMenu(){ if(__moreMenu) __moreMenu.hidden = true; }
/*더보기 팝업관련 함수 끝 */

async function getSessionUser() {
  const { data:{ session } } = await supabase.auth.getSession();
  return session?.user ?? null;
}

async function createPost({ title, body_md, images=[], tags=[], visibility='public' }) {
  const { data, error } = await supabase.rpc('create_post', {
    p_title: title,
    p_body_md: body_md,
    p_images: images,
    p_tags: tags,
    p_visibility: visibility
  });
  if (error) throw error;
  return data; // new post id
}

async function loadFeed({ append=false, queryText=currentQuery } = {}) {
  if (paging.loading || paging.done) return;
  paging.loading = true;

  const from = append ? paging.from : 0;
  const to   = from + FEED_LIMIT - 1;

  let q = supabase
    .from('community_posts')
    .select('id, author_id, title, body_md, images, tags, like_count, comment_count, created_at, deleted_at, visibility, author:profiles!community_posts_author_id_fkey(nickname)', { count: 'exact' })
    .is('deleted_at', null)
    .eq('visibility', 'public');

  if (queryText && queryText.trim()) {
    const kw = queryText.trim();
    q = q.or(`title.ilike.%${kw}%,body_md.ilike.%${kw}%`);
    // facility_name 컬럼이 있으면 여기에 추가:
    // q = q.or(`title.ilike.%${kw}%,body_md.ilike.%${kw}%,facility_name.ilike.%${kw}%`);
  }

  q = q.order('created_at', { ascending: false }).range(from, to);

  const { data, error } = await q;
  if (error) { console.error('loadFeed error:', error); alert('목록을 불러오지 못했습니다. 콘솔을 확인하세요.'); paging.loading = false; return; }

  const list = $('#feed');
  if (!append) list.innerHTML = '';

  const rows = data.filter(p=>{
    if (currentCategory === '전체') return true;
    const tags = Array.isArray(p.tags) ? p.tags : [];
    return tags.some(t => String(t).trim() === `주제:${currentCategory}`);
  });
  rows.forEach(p => list.appendChild(renderPostItem(p)));
  if (!append && (!rows || data.length === 0)) {
    const empty = document.createElement('div');
    empty.className = 'post';
    empty.textContent = '게시글이 없습니다.';
    list.appendChild(empty);
  }
  paging.from = to + 1;
  paging.done = !data || data.length < FEED_LIMIT;
  paging.loading = false;
}
function updateNav(slider, idx, n){
  const cur  = slider.querySelector('.pager .cur');
  const prev = slider.querySelector('.nav-prev');
  const next = slider.querySelector('.nav-next');
  if (cur)  cur.textContent = String(idx+1);
  if (prev) prev.disabled = (idx===0);
  if (next) next.disabled = (idx===n-1);
}
function slideTo(slider, idx){
  const slidesEl = slider.querySelector('.slides');
  const items = slider.querySelectorAll('.slide');
  const n = items.length;
  if (!slidesEl || !n) return;

  idx = Math.max(0, Math.min(idx, n-1));
  slider.dataset.idx = String(idx);

  // 기준 오프셋 보정
  const base = items[0].offsetLeft;
  const x = (items[idx].offsetLeft - base);
  slidesEl.scrollTo({ left: x, behavior: 'smooth' });

  updateNav(slider, idx, n);
}
function getTopicFromTags(tags){
  if (!Array.isArray(tags)) return '';
  for (const t of tags){
    if (typeof t !== 'string') continue;
    const m = /^\s*주제\s*:\s*(.+)\s*$/.exec(t);
    if (m) return m[1].trim();
  }
  return '';
}


async function reportPost(postId){
  // 로그인 체크
  const { data:{ session } } = await supabase.auth.getSession();
  if (!session?.user?.id) { alert('로그인 후 이용해 주세요.'); return; }

  const ok = confirm('이 게시글을 신고하시겠습니까?');
  if (!ok) return;
  const reason = prompt('신고 사유를 입력해 주세요. 예: 부적절한 내용');
  if (!reason) return;

  try{
    const { error } = await supabase.from('community_reports').insert({
      target: 'post',
      target_id: postId,
      reporter: session.user.id,   // RLS: reporter = auth.uid()
      reason: reason
    });
    if (error) throw error;
    alert('신고가 접수되었습니다.');
  }catch(e){
    alert(e.message || '신고 실패');
  }
}

function initSliderRuntime(slider){
  const slidesEl = slider.querySelector('.slides');
  if (!slidesEl) return;

  // 스크롤 중에는 “표시만” 동기화
  slidesEl.addEventListener('scroll', ()=>{
    const items = slider.querySelectorAll('.slide');
    if (!items.length) return;

    const base = items[0].offsetLeft;
    let best = 0, bestDist = Infinity;
    items.forEach((it,i)=>{
      const dist = Math.abs((it.offsetLeft - base) - slidesEl.scrollLeft);
      if (dist < bestDist){ bestDist = dist; best = i; }
    });
    if (String(best) !== slider.dataset.idx){
      slider.dataset.idx = String(best);
      updateNav(slider, best, items.length);
    }
  }, { passive:true });

  // 초기 내비 상태 세팅
  const n = slider.querySelectorAll('.slide').length;
  const idx = Number(slider.dataset.idx||0);
  updateNav(slider, Math.max(0, Math.min(idx, n-1)), n);
}
function bindFeedClicks(){
  $('#feed').addEventListener('click', (e)=>{
    const btn = e.target.closest('button, .dot');
    if (!btn) return;

    if (btn.classList.contains('btn-like')) { toggleLike(Number(btn.dataset.id), btn); return; }
    if (btn.classList.contains('btn-cmt'))  { openCommentsModal(Number(btn.dataset.id)); return; }
    if (btn.classList.contains('btn-del'))  { softDelete(Number(btn.dataset.id), btn); return; }
    if (btn.classList.contains('more-btn')) { 
      const host = btn.closest('.post'); 
      const m = ensureMoreMenu();
      const isSame = !m.hidden && m.dataset.postId === btn.closest('.post')?.dataset.postId;
      if (isSame) closeMoreMenu(); else openMoreMenu(btn);
      return;
    }

    const slider = btn.closest('.slider');
    if (!slider) return;

    const n = slider.querySelectorAll('.slide').length;
    let idx = Number(slider.dataset.idx||'0');

    if (btn.classList.contains('nav-prev')) { slideTo(slider, Math.max(0, idx-1)); return; }
    if (btn.classList.contains('nav-next')) { slideTo(slider, Math.min(n-1, idx+1)); return; }
    if (btn.classList.contains('dot'))      { slideTo(slider, Number(btn.dataset.i)||0); return; }
  });

  // 기존 #feed 스크롤 리스너는 불필요 → 제거

  // 동적 생성 대응
  const mo = new MutationObserver(muts=>{
    for (const m of muts){
      m.addedNodes.forEach(node=>{
        if (node.nodeType===1){
          if (node.classList?.contains('slider')) initSliderRuntime(node);
          node.querySelectorAll?.('.slider').forEach(initSliderRuntime);
        }
      });
    }
  });
  mo.observe($('#feed'), { childList:true, subtree:true });

  // 초기 렌더된 슬라이더도 1회 초기화
  $$('.slider', $('#feed')).forEach(initSliderRuntime);
}
function renderPostItem(p){
  const el = document.createElement('article');
  el.className = 'post'; el.dataset.postId = p.id;

  const imgs = Array.isArray(p.images) ? p.images : [];
  let media = '';

  if (imgs.length > 1){
    media = `
      <div class="slider" data-idx="0" data-images='${JSON.stringify(imgs)}'>
        <div class="slides">
          ${imgs.map((u,i)=>`<div class="slide"><img src="${esc(u)}" alt="" loading="lazy" decoding="async" data-idx="${i}"></div>`).join('')}
        </div>
        <button class="nav nav-prev" type="button" aria-label="이전">‹</button>
        <button class="nav nav-next" type="button" aria-label="다음">›</button>
        <div class="pager"><span class="cur">1</span>/<span class="tot">${imgs.length}</span></div>
      </div>`;
  } else if (imgs.length === 1){
    media = `
      <figure class="media-single" data-images='${JSON.stringify(imgs)}'>
        <img src="${esc(imgs[0])}" alt="" loading="lazy" decoding="async">
      </figure>`;
  }

  const mine = me && me.id === p.author_id;
  const topic = getTopicFromTags(p.tags) || '기타'; // 없으면 기본값
  el.innerHTML = `
    <button class="more-btn" type="button" aria-label="게시글 옵션">⋮</button>
    <h2 class="post-title">${esc(p.title)}</h2>
    <p class="post-meta">${esc(topic)} · ${esc(p.author?.nickname || '익명')} · ${new Date(p.created_at).toLocaleString()}</p>
    ${media}
    <p class="post-body">${esc(p.body_md)}</p>
    <div class="actions">
      <button class="btn btn-like" type="button" data-id="${p.id}" aria-pressed="false" title="좋아요">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path class="heart-outline" d="M12.1 8.64l-.1.1-.11-.1C10.14 6.9 7.1 7.24 5.6 9.09c-1.56 1.93-1.2 4.78.73 6.34l5.67 4.6 5.67-4.6c1.93-1.56 2.3-4.41.73-6.34-1.5-1.85-4.54-2.19-6.3-.45z" fill="none" stroke="currentColor" stroke-width="1.6"/>
          <path class="heart-fill" d="M12 20.03l-6.16-5c-2.52-2.05-2.99-5.74-1.03-8.25 1.83-2.25 5.3-2.61 7.61-.8 2.3-1.81 5.78-1.45 7.61.8 1.96 2.51 1.49 6.2-1.03 8.25L12 20.03z" fill="currentColor"/>
        </svg>
        <span class="like-c">${p.like_count||0}</span>
      </button>
      <button class="btn btn-cmt"  type="button" data-id="${p.id}" title="댓글 보기">💬 <span class="cmt-c">${p.comment_count||0}</span></button>
      ${mine ? `<button class="btn btn-del" type="button" data-id="${p.id}">삭제</button>` : ``}
    </div>`;
  return el;
}

async function toggleLike(postId, btn) {
  btn.disabled = true;
  try {
    const { data, error } = await supabase.rpc('toggle_like', { p_post_id: postId });
    if (error) throw error;

    // 낙관적 카운터 갱신
    const cEl = btn.querySelector('.like-c');
    const cur = Number(cEl.textContent||'0');
    cEl.textContent = data ? cur + 1 : Math.max(0, cur - 1);
    // 아이콘 토글
    if (data){ // 이제 좋아요 상태
      btn.classList.add('is-on'); btn.setAttribute('aria-pressed','true');
    } else {
      btn.classList.remove('is-on'); btn.setAttribute('aria-pressed','false');
    }
  } catch (e) {
    alert(e.message || '실패했습니다.');
  } finally {
    btn.disabled = false;
  }
}

async function addComment(postId) {
  const body = window.prompt('댓글을 입력해 주세요');
  if (!body) return;
  try {
    const { data, error } = await supabase.rpc('add_comment', { p_post_id: postId, p_body_md: body, p_parent_id: null });
    if (error) throw error;

    // 화면 카운터 +1
    const host = $(`article.post[data-post-id="${postId}"]`);
    const c = host?.querySelector('.cmt-c');
    if (c) c.textContent = String(Number(c.textContent||'0') + 1);
  } catch (e) {
    alert(e.message || '실패했습니다.');
  }
}

async function softDelete(postId, btn) {
  if (!confirm('이 글을 숨기시겠습니까?')) return;
  btn.disabled = true;
  try {
    const { error } = await supabase.rpc('soft_delete_post', { p_post_id: postId });
    if (error) throw error;
    // 목록에서 제거
    const host = $(`article.post[data-post-id="${postId}"]`);
    host?.remove();
  } catch (e) {
    alert(e.message || '삭제 실패');
  } finally {
    btn.disabled = false;
  }
}
function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }

function bindSearchUI(){
  const wrap  = document.querySelector('header .search');
  const input = wrap?.querySelector('input[type="search"]');
  if (!input) return;

  // 초기 값 채우기
  if (currentQuery) input.value = currentQuery;

  // 돋보기 버튼 없으면 생성
  if (!wrap.querySelector('.search-btn')){
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'search-btn'; btn.setAttribute('aria-label','검색');
    btn.textContent = '🔍';
    wrap.appendChild(btn);
    btn.addEventListener('click', (e)=>{
      e.preventDefault();
      e.stopPropagation();
      runSearchNow();
    });
  }
  
  const run = debounce(runSearchNow, 250);

  input.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); runSearchNow(); }});
  input.addEventListener('input', run);
  input.addEventListener('search', run); // X 클릭

  function runSearchNow(){
    currentQuery = String(input.value||'').trim();
    paging = { from: 0, loading: false, done: false };
    // URL 동기화
    const usp = new URLSearchParams(location.search);
    if (currentQuery) usp.set('q', currentQuery); else usp.delete('q');
    history.replaceState(null, '', `${location.pathname}?${usp.toString()}`);
    // 로드
    loadFeed({ append:false, queryText: currentQuery });
  }
}




function bindInfiniteScroll() {
  const sentinel = document.createElement('div');
  sentinel.id = 'feed-sentinel';
  sentinel.style.height = '1px';
  $('#feedWrap').appendChild(sentinel);

  const io = new IntersectionObserver(async (entries) => {
    if (entries.some(en => en.isIntersecting)) await loadFeed({ append:true, queryText: currentQuery });
  }, { rootMargin: '1000px 0px' });
  io.observe(sentinel);
}

function subscribeRealtime() {
  // 새 댓글/좋아요 알림 대신 카운터는 후행 반영. 필요 시 실시간으로 갱신.
  try {
    const ch = supabase.channel('comm-live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'community_comments' },
        (payload) => {
          const postId = payload.new.post_id;
          const host = $(`article.post[data-post-id="${postId}"]`);
          const c = host?.querySelector('.cmt-c');
          if (c) c.textContent = String(Number(c.textContent||'0') + 1);
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'community_reactions' },
        (payload) => {
          const postId = payload.new.post_id;
          const host = $(`article.post[data-post-id="${postId}"]`);
          const c = host?.querySelector('.like-c');
          if (c) c.textContent = String(Number(c.textContent||'0') + 1);
        }
      )
      .subscribe();
  } catch {}
}

document.addEventListener('DOMContentLoaded', async () => {
  me = await getSessionUser();

  // --- 라이트박스 1회 생성 ---
  const lb = document.createElement('div');
  lb.className = 'lb';
  lb.setAttribute('aria-hidden','true');
  lb.innerHTML = `
    <div class="lb-inner">
      <button class="lb-btn lb-prev" aria-label="이전">‹</button>
      <img class="lb-img" alt="">
      <button class="lb-btn lb-next" aria-label="다음">›</button>
      <button class="lb-btn lb-close" aria-label="닫기">✕</button>
    </div>`;
  document.body.appendChild(lb);

  const lbImg   = lb.querySelector('.lb-img');
  const btnPrev = lb.querySelector('.lb-prev');
  const btnNext = lb.querySelector('.lb-next');
  const btnClose= lb.querySelector('.lb-close');
  let lbList = [];
  let lbIdx  = 0;

  function lbShow(list, idx=0){
    lbList = list || [];
    lbIdx  = Math.max(0, Math.min(idx, lbList.length-1));
    lbImg.src = lbList[lbIdx] || '';
    lb.setAttribute('aria-hidden','false');
  }
  function lbHide(){
    lb.setAttribute('aria-hidden','true');
    lbImg.src = '';
  }
  function lbNav(d){
    if (!lbList.length) return;
    lbIdx = (lbIdx + d + lbList.length) % lbList.length;
    lbImg.src = lbList[lbIdx];
  }

  btnPrev.addEventListener('click', ()=>lbNav(-1));
  btnNext.addEventListener('click', ()=>lbNav(+1));
  btnClose.addEventListener('click', lbHide);
  lb.addEventListener('click', (e)=>{ if (e.target === lb) lbHide(); });
  document.addEventListener('keydown', (e)=>{
    if (lb.getAttribute('aria-hidden') !== 'false') return;
    if (e.key === 'Escape') lbHide();
    if (e.key === 'ArrowLeft') lbNav(-1);
    if (e.key === 'ArrowRight') lbNav(+1);
  });

  // 슬라이더 이미지 클릭 → 라이트박스 오픈
  document.addEventListener('click', (e)=>{
    // 슬라이더 이미지
    const img1 = e.target.closest('.slider .slide img');
    if (img1){
      const slider = img1.closest('.slider');
      const list = JSON.parse(slider.getAttribute('data-images')||'[]');
      const idx  = Number(img1.getAttribute('data-idx')||0);
      if (list.length) lbShow(list, idx);
      return;
    }
    // 단일 이미지
    const img2 = e.target.closest('.media-single img');
    if (img2){
      const wrap = img2.closest('.media-single');
      const list = JSON.parse(wrap.getAttribute('data-images')||'[]');
      lbShow(list.length?list:[img2.src], 0);
    }
  });

  const feedWrap = document.getElementById('feedWrap');
  const feed = document.getElementById('feed');
  if (!feedWrap || !feed) { console.error('feed container missing'); return; }

  bindChips();
  bindFeedClicks();
  bindSearchUI();
  bindInfiniteScroll();
  subscribeRealtime();

  const searchInput = document.querySelector('header .search input[type="search"]');
  if (facility && searchInput) searchInput.value = facility;

  paging = { from: 0, loading: false, done: false };
  await loadFeed({ append:false, queryText: currentQuery });

  if (facility) {
    const first = document.querySelector('#feed .post');
    first?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  syncChipActive();
});
function bindChips(){
  const row = document.querySelector('.chiprow'); if(!row) return;
  row.addEventListener('click', (e)=>{
    const btn = e.target.closest('.chip'); if(!btn) return;
    const label = btn.textContent.trim();
    currentCategory = label;               // 상태 변경
    syncChipActive();                      // UI 반영
    paging = { from: 0, loading: false, done: false };
    loadFeed({ append:false, queryText: currentQuery }); // 재로드
  });
}
function syncChipActive(){
  document.querySelectorAll('.chiprow .chip').forEach(b=>{
    const on = b.textContent.trim() === currentCategory;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}
// ===== 댓글 모달 생성 =====
const cm = document.createElement('div');
cm.className = 'cmt-modal'; cm.setAttribute('aria-hidden','true');
cm.innerHTML = `
  <div class="cmt-modal__dialog" role="dialog" aria-modal="true" aria-label="댓글">
    <div class="cmt-modal__head">
      <strong>댓글</strong>
      <button type="button" class="cmt-close" aria-label="닫기">✕</button>
    </div>
    <div class="cmt-modal__list" id="cmtList"></div>
    <form class="cmt-modal__form" id="cmtForm">
      <textarea id="cmtInput" placeholder="댓글을 입력하세요"></textarea>
      <button type="submit" class="btn">등록</button>
    </form>
  </div>`;
document.body.appendChild(cm);
const cmtList  = cm.querySelector('#cmtList');
const cmtForm  = cm.querySelector('#cmtForm');
const cmtInput = cm.querySelector('#cmtInput');
let cmtPostId  = null;

function openCommentsModal(postId){
  cmtPostId = postId;
  cm.setAttribute('aria-hidden','false');
  loadComments(postId);
  cmtInput.value=''; cmtInput.focus();
}
function closeCommentsModal(){ cm.setAttribute('aria-hidden','true'); cmtPostId=null; cmtList.innerHTML=''; }
cm.addEventListener('click',e=>{ if(e.target===cm) closeCommentsModal(); });
cm.querySelector('.cmt-close').addEventListener('click', closeCommentsModal);
document.addEventListener('keydown',e=>{ if(e.key==='Escape' && cm.getAttribute('aria-hidden')==='false') closeCommentsModal(); });

async function loadComments(postId){
  cmtList.innerHTML = '불러오는 중...';
  const { data, error } = await supabase
    .from('community_comments')
    .select('id, author_id, body_md, created_at, author:profiles!community_comments_author_id_fkey(nickname)')
    .eq('post_id', postId)
    .order('created_at', { ascending: true })
  if(error){ cmtList.textContent='불러오기 실패'; return; }
  if(!data.length){ cmtList.textContent='첫 댓글을 남겨보세요.'; return; }
  cmtList.innerHTML = data.map(r=>`
    <div class="cmt-item" data-id="${r.id}">
      <div class="cmt-meta">${esc(r.author?.nickname || '익명')} · ${new Date(r.created_at).toLocaleString()}</div>
      <div class="cmt-body">${esc(r.body_md||'')}</div>
    </div>`).join('');
  cmtList.scrollTop = cmtList.scrollHeight;
}
cmtForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const txt = String(cmtInput.value||'').trim(); if(!txt || !cmtPostId) return;
  const { error } = await supabase.rpc('add_comment', { p_post_id: cmtPostId, p_body_md: txt, p_parent_id: null });
  if(error){ alert(error.message||'등록 실패'); return; }
  cmtInput.value=''; await loadComments(cmtPostId);
  // 화면의 댓글 카운터 +1
  const host = document.querySelector(`article.post[data-post-id="${cmtPostId}"] .cmt-c`);
  if(host) host.textContent = String(Number(host.textContent||'0')+1);
});

async function primeLikeState(btn, postId){
  const { data:{session} } = await supabase.auth.getSession();
  if(!session?.user?.id) return;
  const { data, error } = await supabase
    .from('community_reactions')
    .select('id').eq('post_id', postId).eq('user_id', session.user.id).limit(1).maybeSingle();
  if(!error && data){
    btn.classList.add('is-on'); btn.setAttribute('aria-pressed','true');
  }
}
// 새로 추가: feed 영역에 붙는 순간 초기화
const mo2 = new MutationObserver(muts=>{
  for(const m of muts){
    m.addedNodes.forEach(node=>{
      if(node.nodeType!==1) return;
      node.querySelectorAll?.('.btn-like[data-id]').forEach(b=>primeLikeState(b, Number(b.dataset.id)));
    });
  }
});
mo2.observe(document.getElementById('feed'), { childList:true, subtree:true });