//* main.js  — REPLACE ALL

/* ---------- 아이콘 매핑 ---------- */
const ICONS = {
  welfare: { url: './img/welfare.png', w: 32, h: 44, ax: 16, ay: 44 },
  dance:   { url: './img/dance.png',   w: 32, h: 44, ax: 16, ay: 44 },
  sports:  { url: './img/sports.png',  w: 32, h: 44, ax: 16, ay: 44 },
  elder:   { url: './img/elder.png',   w: 32, h: 44, ax: 16, ay: 44 },
  hospital:{ url: './img/hospital.png',w: 32, h: 44, ax: 16, ay: 44 },
  goclub:  { url: './img/goclub.png',  w: 32, h: 44, ax: 16, ay: 44 },
  yoga:    { url: './img/yoga.png',    w: 32, h: 44, ax: 16, ay: 44 },
  golfclub:{ url: './img/golfclub.png',w: 32, h: 44, ax: 16, ay: 44 },
  park:    { url: './img/park.png',    w: 32, h: 44, ax: 16, ay: 44 },
  daycare: { url: './img/daycare.png', w: 32, h: 44, ax: 16, ay: 44 },
  default: { url: './img/default2.png', w: 28, h: 40, ax: 14, ay: 40 }
};
const CATEGORY_TREE = {
  sports:   ['dance','sports','yoga','golfclub','park'],
  welfare:   ['welfare','elder','daycare','goclub','hospital']
};
const FILTER_TYPES = Object.values(CATEGORY_TREE).flat();
function iconFromType(type){ return ICONS[type] || ICONS.default; }
//const FILTER_TYPES = ['welfare','dance', 'sports', 'elder', 'hospital','goclub','yoga','park','golfclub', 'daycare'];
const saved = JSON.parse(localStorage.getItem('ui.typeFilters')||'[]');
const valid = Array.isArray(saved) ? saved.filter(t => FILTER_TYPES.includes(t)) : [];
let activeTypes = new Set(valid.length ? valid : FILTER_TYPES);
/* 타입 라벨 */
const PARENT_LABELS = { sports:'스포츠', welfare:'복지·시니어' };
function labelOfType(t){
  return ({welfare:'복지',dance:'댄스', sports:'스포츠시설', elder:'경로당', hospital:'병원',goclub:'기원',yoga:'요가원',park:'공원',golfclub:'골프장', daycare:'데이케어센터'})[t]||t;
}

/* ---------- 카드 → 아이콘 ---------- */
function getIconForCard(card){
  const { iconUrl, iconW, iconH, iconAx, iconAy, type } = card.dataset;
  if (iconUrl) {
    return {
      url: iconUrl,
      w: Number(iconW)||28, h: Number(iconH)||40,
      ax: Number(iconAx)||14, ay: Number(iconAy)||40
    };
  }
  return iconFromType(type);
}

/* ---------- 맵 통신 ---------- */
const MAP_ORIGIN = (location.origin && location.origin !== 'null') ? location.origin : '*';
function postToMap(msg){
  const f = document.getElementById('mapFrame');
  if (!f || !f.contentWindow) return;
  f.contentWindow.postMessage(msg, MAP_ORIGIN);
}

/* ---------- 카드 → 마커 추가 ---------- */
function addArticleMarker(card, {center=false, zoom=16} = {}){
  const id    = card.dataset.id || (card.dataset.address || `${card.dataset.lat},${card.dataset.lng}`);
  const title = card.dataset.title || card.querySelector('h3')?.textContent?.trim() || '제목 없음';
  const icon  = getIconForCard(card);

  if (card.dataset.lat && card.dataset.lng) {
    postToMap({ type:'ADD_MARKER',
      payload:{ id, lat:+card.dataset.lat, lng:+card.dataset.lng, title, icon, center, zoom }
    });
  } else if (card.dataset.address) {
    postToMap({ type:'ADD_MARKER_BY_ADDRESS',
      payload:{ id, address:card.dataset.address, title, icon, center, zoom }
    });
  }
}

/* 필터 UI 생성 */
/* 필터 UI 생성: 상위(아코디언) · 하위(체크) */
function attachFilterUI(){
  const btnFilter = document.getElementById('btnFilter');
  if (!btnFilter) return;

  let box = document.getElementById('filterPanelBox');
  if (!box){
    box = document.createElement('div');
    box.id = 'filterPanelBox';
    box.className = 'filter-fly';
    box.setAttribute('aria-hidden','true');

    // 그룹 마크업 생성
    const groups = Object.entries(CATEGORY_TREE).map(([parent, kids])=>{
      const kidsHtml = kids.map(v=>`
        <label><input type="checkbox" name="types" value="${v}" data-child-of="${parent}">
          <span>${labelOfType(v)}</span></label>`).join('');
      return `
        <div class="group" data-group="${parent}">
          <div class="group-header">
            <label class="parent">
              <input type="checkbox" data-parent="${parent}">
              <span>${PARENT_LABELS[parent]||parent}</span>
            </label>
            <button type="button" class="group-toggle" aria-expanded="true">
              <span class="sr-only">${PARENT_LABELS[parent]||parent} 펼치기/접기</span>
            </button>
          </div>
          <div class="group-children">${kidsHtml}</div>
        </div>`;
    }).join('');

    box.innerHTML = `
      <div class="filter-panel__title">카테고리 선택</div>
      <div class="checks">
        <label class="master"><input type="checkbox" id="chkAll"><span class="master-label">전체</span></label>
        ${groups}
      </div>
      <div class="filter-actions">
        <button type="button" class="btn" data-act="cancel">취소</button>
        <button type="button" class="primary" data-act="apply">적용</button>
      </div>`;
    document.body.appendChild(box);
  }

  const wrap   = box.querySelector('.checks');
  const chkAll = wrap.querySelector('#chkAll');

  const items  = () => Array.from(wrap.querySelectorAll('input[name="types"]'));
  const byPar  = (p) => Array.from(wrap.querySelectorAll(`input[name="types"][data-child-of="${p}"]`));
  const groupsEls = () => Array.from(wrap.querySelectorAll('.group'));

  function setGroupExpanded(groupEl, expanded){
    const btn = groupEl.querySelector('.group-toggle');
    const kids = groupEl.querySelector('.group-children');
    btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    if (expanded){ kids.removeAttribute('hidden'); } else { kids.setAttribute('hidden',''); }
  }

  function syncParentState(p){
    const kids = byPar(p);
    const on = kids.filter(i=>i.checked).length;
    const pe = wrap.querySelector(`input[data-parent="${p}"]`);
    if (!pe) return;
    pe.indeterminate = on>0 && on<kids.length;
    pe.checked = on===kids.length;
  }
  function syncAllState(){
    const a = items();
    const on = a.filter(i=>i.checked).length;
    chkAll.indeterminate = on>0 && on<a.length;
    chkAll.checked = on===a.length;
  }
  function syncFromActive(){
    items().forEach(i=> i.checked = activeTypes.has(i.value));
    Object.keys(CATEGORY_TREE).forEach(syncParentState);
    syncAllState();
  }

  // 패널 위치
  function placeBox(){
    const r = btnFilter.getBoundingClientRect();
    const desiredLeft = r.right - box.offsetWidth;
    const left = Math.max(8, Math.min(desiredLeft, window.innerWidth - box.offsetWidth - 8));
    const top  = r.bottom + 8;
    box.style.left = (left + window.scrollX) + 'px';
    box.style.top  = (top  + window.scrollY) + 'px';
  }

  function open(){
    box.style.visibility = 'hidden';
    box.setAttribute('aria-hidden','false');
    syncFromActive();
    // 초기는 모두 펼침
    groupsEls().forEach(g=> setGroupExpanded(g, true));
    requestAnimationFrame(()=>{ placeBox(); box.style.visibility = ''; });
    btnFilter.setAttribute('aria-expanded','true');
  }
  function close(){
    box.setAttribute('aria-hidden','true');
    btnFilter.setAttribute('aria-expanded','false');
  }

  // 버튼 토글
  btnFilter.setAttribute('aria-haspopup','true');
  btnFilter.addEventListener('click', (e)=>{
    e.stopPropagation();
    const openNow = box.getAttribute('aria-hidden')==='false';
    openNow ? close() : open();
  });

  // 아코디언 토글
  wrap.addEventListener('click', (e)=>{
    const btn = e.target.closest('.group-toggle');
    if (!btn) return;
    const g = btn.closest('.group');
    const expanded = btn.getAttribute('aria-expanded')==='true';
    setGroupExpanded(g, !expanded);
  });

  // 외부 클릭/ESC/리사이즈
  document.addEventListener('click', (e)=>{ if (box.getAttribute('aria-hidden')==='false' && !box.contains(e.target) && e.target!==btnFilter) close(); });
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') close(); });
  window.addEventListener('resize', ()=>{ if (box.getAttribute('aria-hidden')==='false') placeBox(); });
  window.addEventListener('scroll', ()=>{ if (box.getAttribute('aria-hidden')==='false') placeBox(); }, { passive:true });

  // 체크 로직
  chkAll.addEventListener('change', ()=>{
    const on = chkAll.checked;
    items().forEach(i=> i.checked = on);
    Object.keys(CATEGORY_TREE).forEach(syncParentState);
    chkAll.indeterminate = false;
  });
  wrap.addEventListener('change', (e)=>{
    const t = e.target;
    if (t.matches('input[data-parent]')){
      const p = t.getAttribute('data-parent');
      byPar(p).forEach(i=> i.checked = t.checked);
      syncParentState(p); syncAllState();
    } else if (t.name === 'types'){
      const p = t.getAttribute('data-child-of');
      if (p) syncParentState(p);
      syncAllState();
    }
  });

  // 적용/취소
  box.querySelector('[data-act="cancel"]').addEventListener('click', close);
  box.querySelector('[data-act="apply"]').addEventListener('click', ()=>{
    const selected = items().filter(i=>i.checked).map(i=>i.value);
    const next = selected.length ? selected : FILTER_TYPES.slice(); // 무선택 → 전체
    activeTypes = new Set(next);
    localStorage.setItem('ui.typeFilters', JSON.stringify([...activeTypes]));
    close();

    // 결과 반영
    const m1 = filterList(document.getElementById('programList'), '', INITIAL_COUNT);
    const m2 = filterList(document.getElementById('seniorList'),  '', INITIAL_COUNT);
    document.getElementById('programList')?.__refreshCollapsible?.();
    document.getElementById('seniorList')?.__refreshCollapsible?.();
    updateMapForCards([...m1, ...m2]);
  });

  // 필요 시 외부에서 열기
  window.addEventListener('open-type-filters', open);
}

/* ---------- MAP 메시지 수신: 초기 마커 + 마커클릭 → 카드 포커스 ---------- */
window.addEventListener('message', (e)=>{
  if (MAP_ORIGIN !== '*' && e.origin !== MAP_ORIGIN) return;
  const msg = e.data || {};

  if (msg.type === 'MAP_READY') {
    document.querySelectorAll('.card').forEach(card => addArticleMarker(card, {center:false}));
    return;
  }

  if (msg.type === 'MARKER_CLICK') {
    const card = findCardByMarkerPayload(msg.payload || {});
    if (!card) return;

    // 소속 리스트
    const list = card.closest('.list');
    if (!list) return;

    // 접힘 해제, 숨김 해제
    list.setAttribute('data-collapsed','false');
    card.classList.remove('dn');

    // 맨 위로 이동
    if (list.firstElementChild !== card) {
      list.insertBefore(card, list.firstElementChild);
    }

    // 강조 토글
    document.querySelectorAll('.card.is-active').forEach(el => el.classList.remove('is-active'));
    card.classList.add('is-active');

    // 헤더 높이 보정 스크롤
    scrollCardToTop(card);

    // 강조 해제
    setTimeout(()=>card.classList.remove('is-active'), 1600);
  }
});

/* ---------- 카드 내 버튼 클릭 시 포커스 ---------- */
document.addEventListener('click', (e)=>{
  const r = e.target.closest('.card [data-act="review"]');
  if (!r) return;
  e.preventDefault();
  const card = r.closest('.card');
  const facility =
    card.querySelector('h3')?.textContent?.trim() ||
    card.dataset.title || '';
  // 필요하면 id도 함께 전달: &fid=${encodeURIComponent(card.dataset.id||'')}
  location.href = `./community.html?q=${encodeURIComponent(facility)}`;
});
document.addEventListener('click', (e)=>{
  const btn = e.target.closest('.card [data-act="locate"], .card .primary');
  if (!btn) return;
  const card = btn.closest('.card');
  addArticleMarker(card, { center:true, zoom:16 });
});

/* =========================================================
   접기/펼치기 + 검색 + 지도 동기화
   ========================================================= */

const INITIAL_COUNT = 3;

/* 유틸 */
function norm(t){ return String(t||'').toLowerCase().trim(); }
function terms(q){ return norm(q).split(/\s+/).filter(Boolean); }
function ensureMoreLabelSpan(btn){
  let span = btn.querySelector('.more-label');
  if(!span){
    btn.innerHTML = '<span class="more-label"></span>';
    span = btn.querySelector('.more-label');
  }
  return span;
}

function updateMoreLabel(listEl, btn, initial, cards){
  const collapsed = listEl.getAttribute('data-collapsed') === 'true';
  const total = cards.length;
  const visible = collapsed ? Math.min(initial, total) : total;

  const span = ensureMoreLabelSpan(btn);
  span.textContent = collapsed
    ? `＋ 더보기 (${visible}/${total})`
    : `접기 (${visible}/${total})`;

  btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
}

/* 카드 매칭: 제목(h3) + data-type + data-title AND 매칭 */
function matchesCard(card, qs){
  const type = card.dataset.type || '';
  // 데이터에 없는 타입은 제외
  if (!FILTER_TYPES.includes(type)) return false;
  // 체크박스 필터
  if (!activeTypes.size || !activeTypes.has(type)) return false;

  if (qs.length === 0) return true;
  const title = card.querySelector('h3')?.textContent || '';
  const cat   = card.dataset.title || '';
  const meta  = card.querySelector('.meta')?.textContent || '';
  const hay   = norm([title, type, cat, meta].join(' '));
  return qs.every(k => hay.includes(k));
}

/* 더보기 토글 구성 */
function setupCollapsibleList(listEl, initial = INITIAL_COUNT){
  if(!listEl) return;

  const getCards = () =>
    Array.from(listEl.querySelectorAll('.card'))
      .filter(el => !el.classList.contains('dn') && el.getAttribute('aria-hidden') !== 'true');

  listEl.setAttribute('data-collapsed','true');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'more-toggle';
  btn.setAttribute('aria-expanded','false');
  if(!listEl.id) listEl.id = 'list-' + Math.random().toString(36).slice(2,8);
  btn.setAttribute('aria-controls', listEl.id);
  btn.innerHTML = '<span class="more-label">＋ 더보기</span>';
  listEl.insertAdjacentElement('afterend', btn);

  function applyState(){
    const cards = getCards();
    const collapsed = listEl.getAttribute('data-collapsed') === 'true';

    // initial 이후 숨김
    cards.forEach((el,i)=>{
      const hide = collapsed && i >= initial;
      el.style.display = hide ? 'none' : '';
    });

    // 버튼 노출 여부
    btn.style.display = (cards.length > initial) ? '' : 'none';

    // 라벨/접근성
    const moreCnt = Math.max(0, cards.length - initial);
    btn.setAttribute('aria-expanded', String(!collapsed));
    const labelEl = btn.querySelector('.more-label');
    if(labelEl) labelEl.textContent = collapsed ? `＋ 더보기 (${moreCnt})` : '− 접기';
  }

  btn.addEventListener('click', ()=>{
    const collapsed = listEl.getAttribute('data-collapsed') === 'true';
    listEl.setAttribute('data-collapsed', collapsed ? 'false' : 'true');
    applyState();
  });

  listEl.__refreshCollapsible = applyState;  // 외부에서 갱신용
  applyState(); // 초기 1회 적용
}


/* 리스트 필터링: 매칭된 카드 배열 반환 */
function filterList(listEl, query, initial = INITIAL_COUNT){
  if(!listEl) return [];
  const qs = terms(query);
  const cards = Array.from(listEl.querySelectorAll('.card'));
  const hasQuery = qs.length > 0;

  const matched = [];
  for(const c of cards){
    const ok = matchesCard(c, qs);
    c.classList.toggle('dn', !ok);
    if(ok) matched.push(c);
  }

  // 검색 시 펼침, 검색 해제 시 접힘만 지정
  listEl.setAttribute('data-collapsed', hasQuery ? 'false' : 'true');
  return matched;
}

/* 지도에 매칭 카드만 반영 */
function updateMapForCards(cards){
  postToMap({ type:'RESET_MARKERS' });    // map.js에서 alias 처리
  for(const c of cards){ addArticleMarker(c, { center:false, zoom:16 }); }
  setTimeout(()=>postToMap({ type:'FIT_TO_MARKERS' }), 120); // 지오코딩 비동기 대비
}

/* 검색 실행 */
function runSearch(){
  const $input = document.querySelector('header .search input[type="search"]');
  const q = ($input?.value || '');
  const m1 = filterList(document.getElementById('programList'), q, INITIAL_COUNT);
  const m2 = filterList(document.getElementById('seniorList'),  q, INITIAL_COUNT);
  updateMapForCards([...m1, ...m2]);
  // 더보기 버튼/숨김 재계산(현재 검색 결과 기준)
  document.getElementById('programList')?.__refreshCollapsible?.();
  document.getElementById('seniorList')?.__refreshCollapsible?.();
}

/* 검색 UI 부착 */
function attachSearchUI(){
  const $wrap = document.querySelector('header .search');
  const $input = $wrap?.querySelector('input[type="search"]');
  if(!$wrap || !$input) return;

  // 돋보기 버튼 동적 생성
  if(!$wrap.querySelector('.search-btn')){
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'search-btn';
    btn.setAttribute('aria-label','검색 실행');
    btn.title = '검색';
    btn.textContent = '🔍'; // 필요 시 <img src="./img/search.svg" alt="">
    $wrap.appendChild(btn);
    btn.addEventListener('click', runSearch);
  }

  // Enter, X(지우기) 대응
  $input.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter'){ e.preventDefault(); runSearch(); }
  });
  $input.addEventListener('search', runSearch);
}

/* 초기화 */
function initUI(){
  setupCollapsibleList(document.getElementById('programList'), INITIAL_COUNT);
  setupCollapsibleList(document.getElementById('seniorList'),  INITIAL_COUNT);
  attachSearchUI();
  attachFilterUI();
  runSearch();
}


// CSS.escape 대체
function cssEscapeSafe(s){
  if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(String(s));
  return String(s).replace(/["'\\]/g, '\\$&');
}

function findCardByMarkerPayload({ id, title } = {}){
  if (id){
    let el = document.querySelector(`.card[data-id="${cssEscapeSafe(id)}"]`);
    if (el) return el;
    if (id.startsWith('addr:')){
      const addr = id.slice(5);
      el = document.querySelector(`.card[data-address="${cssEscapeSafe(addr)}"]`);
      if (el) return el;
    }
  }
  if (title){
    const t = String(title).trim();
    for (const el of document.querySelectorAll('.card')){
      const h = el.querySelector('h3')?.textContent?.trim() || '';
      if (h === t || (el.dataset.title||'').trim() === t) return el;
    }
  }
  return null;
}

// 헤더 높이만큼 위로 여유를 두고 스크롤
function scrollCardToTop(card){
  const header = document.querySelector('header');
  const offset = (header?.offsetHeight || 64) + 8; // 여유 8px
  const y = card.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top: y, behavior: 'smooth' });

  // 접근성 포커스
  card.setAttribute('tabindex','-1');
  setTimeout(()=>{ try{ card.focus({ preventScroll:true }); }catch(_){} }, 220);
}

/* DOM 준비 상태에 따라 즉시/지연 실행 */
if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', initUI);
} else {
  initUI();
}
