// /js/daily.js
import { supabase } from './supabase.client.js';

/* =========================
 * 전역 상태
 * ========================= */
let __session = null;
let __uid = null;
let __admin = false;
let __favSet = new Set();
let __appliedSet = new Set();
let __allRows = [];

const MAP_ORIGIN = (location.origin && location.origin !== 'null') ? location.origin : '*';
window.__getSession = async () => (await supabase.auth.getSession()).data.session;

/* =========================
 * 상수 · 유틸
 * ========================= */
const SPORT_OPTS = [
  ['running','러닝'],['weight','웨이트'],['futsal','풋살'],['badminton','배드민턴'],['basketball','농구'],
  ['tennis','테니스'],['hiking','등산'],['cycling','사이클'],['golf','골프'],
  ['squash','스쿼시'],['swimming','수영'],['other','기타(직접입력)']
];
const LABEL_TO_CODE = new Map([
  ['러닝','running'],['웨이트','weight'], ['풋살','futsal'],['배드민턴','badminton'],['농구','basketball'],
  ['테니스','tennis'],['등산','hiking'],['사이클','cycling'],['골프','golf'],
  ['스쿼시','squash'],['수영','swimming'],['기타','other']
]);
const resolveType = (row)=>{
  const t = String(row.type||'').trim();
  if (t) return t;
  const label = String(row.sport_label||'').replace('(직접입력)','').trim();
  return LABEL_TO_CODE.get(label) || 'other';
};
const SPORT_MAP = new Map(SPORT_OPTS);
const sportLabelOf = (code)=> SPORT_MAP.get(code)||'기타';

const SPORT_ICONS = {
  running:{url:'./img/running.png',w:32,h:44,ax:16,ay:44},
  weight:{url:'./img/weight.png',w:32,h:44,ax:16,ay:44},
  futsal:{url:'./img/futsal.png',w:32,h:44,ax:16,ay:44},
  badminton:{url:'./img/badminton.png',w:32,h:44,ax:16,ay:44},
  basketball:{url:'./img/basketball.png',w:32,h:44,ax:16,ay:44},
  tennis:{url:'./img/tennis.png',w:32,h:44,ax:16,ay:44},
  hiking:{url:'./img/hiking.png',w:32,h:44,ax:16,ay:44},
  cycling:{url:'./img/cycling.png',w:32,h:44,ax:16,ay:44},
  golf:{url:'./img/golf.png',w:32,h:44,ax:16,ay:44},
  squash:{url:'./img/squash.png',w:32,h:44,ax:16,ay:44},
  swimming:{url:'./img/swimming.png',w:32,h:44,ax:16,ay:44},
  default:{url:'./img/default.png',w:32,h:44,ax:16,ay:44},
};
const iconFor = (t)=> SPORT_ICONS[t] || SPORT_ICONS.default;

const norm = (s)=> String(s||'').trim().replace(/\s+/g,' ');
const escapeHtml = (str)=> String(str||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDateRange = (st, en)=>{
  const s = new Date(st), e = new Date(en || st);
  const pad = n => String(n).padStart(2,'0');
  const sMD = `${pad(s.getMonth()+1)}/${pad(s.getDate())}`;
  const eMD = `${pad(e.getMonth()+1)}/${pad(e.getDate())}`;
  const sHM = `${pad(s.getHours())}:${pad(s.getMinutes())}`;
  const eHM = `${pad(e.getHours())}:${pad(e.getMinutes())}`;
  return (sMD === eMD) ? `${sMD} ${sHM}~${eHM}` : `${sMD} ${sHM}~${eMD} ${eHM}`;
};
const debounce = (fn, ms=200)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };

function postToMap(msg){
  const frame = document.getElementById('mapFrame');
  if (!frame?.contentWindow) return;
  frame.contentWindow.postMessage(msg, MAP_ORIGIN);
}
const normalizeRow = (r)=> {
  const code = resolveType(r);
  return { ...r, type: code };   // 이후 모든 경로에서 type을 신뢰
};

const toLocalInput = (d)=>{const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;};
const setMinToday = ()=>{
  const min = toLocalInput(new Date());
  document.getElementById('start')?.setAttribute('min', min);
  document.getElementById('end')?.setAttribute('min',  min);
};
const validateRange = ()=>{
  const $s = document.getElementById('start');
  const $e = document.getElementById('end');
  if(!$s || !$e) return true;
  $s.setCustomValidity(''); 
  $e.setCustomValidity('');

  const st = $s.value ? new Date($s.value) : null;
  const en = $e.value ? new Date($e.value) : null;
  const now = new Date();

  if (st && st < now) $s.setCustomValidity('시작 일시는 현재 시각 이후여야 합니다.');
  if (st && en && en < st) $e.setCustomValidity('종료 일시는 시작 일시보다 이전일 수 없습니다.');
  // 여기서는 표시하지 않음
  return !$s.validationMessage && !$e.validationMessage;
};
let __moreMenu = null;
function ensureMoreMenu(){
  if(__moreMenu) return __moreMenu;
  const m=document.createElement('div');
  m.className='more-menu'; m.hidden=true;
  m.innerHTML=`<button type="button" class="mm-item mm-report">신고하기</button>`;
  document.body.appendChild(m);
  __moreMenu=m;

  document.addEventListener('click',(e)=>{
    if(!__moreMenu || __moreMenu.hidden) return;
    if(!e.target.closest('.more-menu, .more-btn')) closeMoreMenu();
  });
  document.addEventListener('keydown',(e)=>{ if(e.key==='Escape') closeMoreMenu(); });

  __moreMenu.addEventListener('click', async (e)=>{
    const btn=e.target.closest('.mm-item'); if(!btn) return;
    const progId=Number(__moreMenu.dataset.progId||'0');
    closeMoreMenu();
    if(btn.classList.contains('mm-report')) reportProgram(progId);
  });
  return m;
}
function openMoreMenu(anchor){
  const host=anchor.closest('article.card'); if(!host) return;
  const id=Number(host.dataset.id||'0');
  const m=ensureMoreMenu(); const r=anchor.getBoundingClientRect();
  m.dataset.progId=String(id);
  m.hidden=false;
  m.style.top = Math.round(window.scrollY + r.bottom + 6)+'px';
  m.style.left= Math.round(window.scrollX + r.right)+'px';
  m.style.transform='translateX(-100%)';
}
function closeMoreMenu(){ if(__moreMenu) __moreMenu.hidden=true; }

async function reportProgram(programId){
  const { data:{session} } = await supabase.auth.getSession();
  if(!session?.user?.id){ alert('로그인 후 이용해 주세요.'); return; }

  let reason = prompt('신고 사유를 입력해 주세요. (2~500자)'); 
  if(reason == null) return;              // 취소
  reason = reason.trim();
  if(reason.length < 2){ alert('신고 사유는 2자 이상이어야 합니다.'); return; }
  if(reason.length > 500) reason = reason.slice(0,500);

  const { error } = await supabase.from('daily_reports').insert({
    target: 'program',
    target_id: programId,
    reporter: session.user.id,
    reason
  });
  if(error){ alert(error.message); return; }
  alert('신고가 접수되었습니다.');
}
/* =========================
 * 데이터 액세스
 * ========================= */
async function currentUid(){ const { data:{ user } } = await supabase.auth.getUser(); return user?.id || null; }
async function isAdmin(){ const { data, error } = await supabase.rpc('is_admin'); if (error){ console.warn(error.message); return false; } return !!data; }
async function myAppliedMap(){
  const { data:{ user } } = await supabase.auth.getUser();
  if (!user) return new Set();
  const { data } = await supabase.from('participation_apps').select('post_id,status').eq('applicant_id', user.id).in('status', ['pending','accepted']);
  return new Set((data||[]).map(r=>r.post_id));
}
async function loadFavSet(){
  const { data:{ session } } = await supabase.auth.getSession();
  __session = session;
  if(!session){ __favSet = new Set(); return; }
  const { data, error } = await supabase.from('daily_favorites').select('post_id').eq('user_id', session.user.id);
  if(error){ console.warn(error.message); __favSet = new Set(); return; }
  __favSet = new Set((data||[]).map(r=>String(r.post_id)));
}
// 위쪽에 이미 있음: SPORT_MAP
// const SPORT_MAP = new Map(SPORT_OPTS);

async function fetchPostsServer(f){
  const filters = f || {};
  let q = supabase
    .from('daily_posts')
    .select('id,user_id,type,sport_label,address,start,end,capacity,host,note,contact,recruit_mode,difficulty,accepted_count,created_at')
    .order('start',{ ascending:true, nullsFirst:true })
    .order('id',{ ascending:false });

  if (filters.sport) q = q.eq('type', filters.sport);
  if (filters.mode) q = q.eq('recruit_mode', filters.mode);
  if (filters.diff) q = q.eq('difficulty',   filters.diff);
  if (filters.from) q = q.gte('start', filters.from + 'T00:00:00');
  if (filters.to)   q = q.lte('end',   filters.to   + 'T23:59:59');

  // 종료된 모집 제외: 시작이 현재 이후
  const nowIso = new Date().toISOString();
  q = q.gte('start', nowIso);

  // 키워드 OR
  const kw = String(filters.q||'').trim();
  if (kw){
    const esc = kw.replace(/[%_]/g, '\\$&');
    q = q.or([
      'address.ilike.%'     + esc + '%',
      'note.ilike.%'        + esc + '%',
      'contact.ilike.%'     + esc + '%',
      'host.ilike.%'        + esc + '%',
      'sport_label.ilike.%' + esc + '%'
    ].join(','));
  }

  const { data, error } = await q;
  if (error){ console.error('fetchPostsServer', error); return []; }
  return data || [];
}

/* =========================
 * 등록폼: 종목 필드
 * ========================= */
function syncOther(){
  const sel=document.getElementById('sportType'); const wrap=document.getElementById('sportOtherWrap'); const input=document.getElementById('sportOther');
  if(!sel||!wrap) return; const on=sel.value==='other'; wrap.hidden=!on; if(input){ input.toggleAttribute('required',on); if(!on) input.value=''; }
}
function renderSportField(selected='running'){
  const host=document.getElementById('sportField'); if(!host) return;
  host.innerHTML = `
    <div class="row">
      <label class="span-2" for="sportType"><span>종목<sup>*</sup></span></label>
      <select id="sportType" name="sport" required>
        ${SPORT_OPTS.map(([v,t])=>`<option value="${v}" ${v===selected?'selected':''}>${t}</option>`).join('')}
      </select>
    </div>
    ${selected==='other'
      ? `<div class="row" id="sportOtherWrap">
           <label class="span-2" for="sportOther">기타 종목명</label>
           <input id="sportOther" placeholder="예: 플로어볼" required />
         </div>` : ``}`;
  document.getElementById('sportType')?.addEventListener('change',(e)=>renderSportField(e.target.value));
}

/* =========================
 * 필터 UI: SPORT_OPTS로 옵션 구성
 * ========================= */
function renderSportFilter(){
  const sel=document.getElementById('fSport'); if(!sel) return;
  const keep=sel.value||''; // 기존 선택 유지
  sel.innerHTML = `<option value="">전체</option>` + SPORT_OPTS.map(([v,t])=>`<option value="${v}">${t.replace('(직접입력)','')}</option>`).join('');
  sel.value = keep;
}

/* =========================
 * 카드 렌더
 * ========================= */
function setFavUI(btn,on){ btn.setAttribute('aria-pressed', on?'true':'false'); btn.textContent = on ? '★' : '☆'; }
function cardHTML(row){
  const code = resolveType(row);
  const when = fmtDateRange(row.start,row.end);
  const title = `${escapeHtml(row.sport_label||sportLabelOf(row.type))} · ${escapeHtml(norm(row.address))}`;
  const modeLabel = row.recruit_mode==='fcfs' ? '선착순' : '선발형';
  const capText = row.capacity ? `정원 ${row.capacity}` : '정원 미정';
  const accepted = Number(row.accepted_count||0);
  const full = row.capacity && accepted >= row.capacity;
  const diffLabel = row.difficulty==='easy'?'쉬움':row.difficulty==='hard'?'어려움':'보통';
  const meta1 = `${when}<br>주최자 ${escapeHtml(row.host||'미상')}· 모집방식 ${modeLabel} · 난이도 ${diffLabel}` + (row.capacity ? `<br>승인 ${accepted} / ${capText} ` : '');
  const meta2 = `${escapeHtml(row.note||'')}${row.contact?` · 연락처 ${escapeHtml(row.contact)}`:''}`.trim();
  const isFav = __favSet.has(String(row.id));
  const favBtn = `<button class="btn fav" type="button" data-fav="${row.id}" aria-pressed="${isFav?'true':'false'}">${isFav?'★':'☆'}</button>`;
  return `
    <article class="card ${full?'is-full':''}" data-id="${row.id}" data-type="${escapeHtml(code)}" data-mode="${row.recruit_mode||'selection'}"
            data-address="${escapeHtml(norm(row.address))}" data-title="${title}" data-user="${row.user_id}" style="position:relative">
      <button class="more-btn" type="button" aria-label="옵션"
              style="position:absolute;top:8px;right:8px;padding:2px 6px;border:0;background:transparent;cursor:pointer">⋮</button>
      <h3>${title}</h3>
      <p class="meta">${meta1}</p>
      ${full ? `<p class="meta" aria-live="polite">정원이 가득 찬 모집입니다.</p>` : ''}
      ${meta2?`<p class="meta">${meta2}</p>`:''}
      <div class="row" style="display:flex;gap:8px;flex-wrap:wrap">
        ${favBtn}
        <button class="primary" type="button" aria-label="${title} 바로보기">위치</button>
        <button class="apply" type="button" data-act="apply">신청</button>
        <button class="btn del" type="button" data-id="${row.id}" hidden>삭제</button>
      </div>
    </article>`;
}

/* =========================
 * 검색 + 필터
 * ========================= */
function renderList(rows, syncMarkers=true){
  const $list = document.getElementById('dailyList');
  $list.innerHTML = rows.map(r=>cardHTML(r)).join('');
  document.getElementById('dailyCount').textContent = `${rows.length}건`;

  if (syncMarkers){
    postToMap({ type:'CLEAR_MARKERS' });
    const one = rows.length === 1;
    rows.forEach(row=>{
      postToMap({
        type:'ADD_MARKER_BY_ADDRESS',
        payload:{
          id:row.id,
          address:norm(row.address||''),
          title:`${row.sport_label || sportLabelOf(row.type)} (${row.host||'주최'})`,
          center: one,
          zoom:   one ? 13 : undefined,
          icon:   iconFor(row.type)        // ← 이제 항상 유효
        }
      });
    });
    if (!one){postToMap({ type:'FIT_TO_MARKERS', payload:{ padding:24 } });}
  }

  rows.forEach(row=>{
    const del = $list.querySelector(`.btn.del[data-id="${row.id}"]`);
    if (del && (__admin || row.user_id===__uid)) del.hidden = false;

    const btn = $list.querySelector(`article.card[data-id="${row.id}"] [data-act="apply"]`);
    if (btn){
      const accepted = Number(row.accepted_count||0);
      const isFull = row.capacity && accepted >= row.capacity;
      const already = __appliedSet.has(row.id);
      const mine = row.user_id===__uid;
      if (!__uid || mine || already || isFull) btn.setAttribute('disabled','true');
      if (already) btn.textContent = '신청 완료';
      else if (mine) btn.textContent = '내 모집';
      else if (isFull) btn.textContent = '정원 초과';
    }
  });
}
function readFilters(){
  const form = document.getElementById('filterForm');
  const get = (k)=> (form ? (new FormData(form).get(k) || '').toString().trim() : '');

  return {
    q:     (document.getElementById('fQ')?.value || '').trim(),
    sport: get('fSport'),
    mode:  get('fMode'),
    diff:  get('fDiff'),
    from:  get('fFrom'),
    to:    get('fTo'),
  };
}

async function applySearchAndFilters(){
  console.log('filters', readFilters()); 
  try{
    const f = readFilters();
    const rows = (await fetchPostsServer(f)).map(normalizeRow);
    __allRows = rows;
    renderList(rows, true);
  }catch(err){
    console.error('applySearchAndFilters', err);
    renderList([], true); // 최소 안전
  }
}

function bindSearchEvents(){
  if(!document.getElementById('fFilter') || !document.getElementById('filterMenu')) console.warn('필터 UI 없음: fFilter/filterMenu 확인');

  ['fSport','fMode','fFrom','fTo','fDiff'].forEach(id=>{
    const el = document.getElementById(id); if(!el) return;
    if(!el) return;
    el.addEventListener('change', applySearchAndFilters);
    el.addEventListener('input',  applySearchAndFilters);
  });
  // 난이도 라디오 그룹
  document.querySelectorAll('input[name="fDiff"]').forEach(el=>{
    el.addEventListener('change', applySearchAndFilters);
  });
  const form = document.getElementById('hdrSearch');
  const inp  = document.getElementById('fQ');
  const btn  = document.getElementById('fFilter');
  const menu = document.getElementById('filterMenu');
  
  form?.addEventListener('submit', (e)=>{ e.preventDefault(); applySearchAndFilters(); });
  if (inp){
    const run = debounce(applySearchAndFilters, 200);
    inp.addEventListener('input', run);   // 타이핑
    inp.addEventListener('search', run);  // ✕ 클릭으로 값 비울 때
  }
  document.querySelector('.searchbar .search-btn')?.addEventListener('click', ()=>applySearchAndFilters());
  
  function openMenu(){ if(menu){ menu.hidden=false; btn?.setAttribute('aria-expanded','true'); } }
  function closeMenu(){ if(menu){ menu.hidden=true;  btn?.setAttribute('aria-expanded','false'); } }
  btn?.addEventListener('click', ()=>{ if (!menu) return; (menu.hidden===false?closeMenu:openMenu)(); });
  document.addEventListener('click', (e)=>{ if (!menu || menu.hidden) return; if (e.target.closest('#filterMenu') || e.target.closest('#fFilter')) return; closeMenu(); });
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeMenu(); });
  document.addEventListener('click', (e)=>{
    
    const btn = e.target.closest('#fApply');
    if (!btn) return;
    e.preventDefault();
    applySearchAndFilters();

    // 메뉴 닫기 상태 동기화
    const menu   = document.getElementById('filterMenu');
    const toggle = document.getElementById('fFilter');
    if (menu){ menu.hidden = true; toggle?.setAttribute('aria-expanded','false'); }
  });
  document.getElementById('filterForm')?.addEventListener('change', ()=>{
    applySearchAndFilters();
  });
  // DOM 파싱 이후 실행되게 하거나, 스크립트를 폼 뒤에 두십시오.
  document.getElementById('fReset')?.addEventListener('click', () => {
    const form = document.getElementById('filterForm');
    form?.reset();

    // 난이도 '전체' 유지
    const diffAll = form?.querySelector('input[name="fDiff"][value=""]');
    if (diffAll) diffAll.checked = true;

    // 변경 트리거 필요 시
    form?.querySelectorAll('select, input').forEach(el => {
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('input',  { bubbles: true }));
    });

    applySearchAndFilters();

    // ★ 창을 닫지 않음: 아래 두 줄을 지우거나, 열린 상태를 명시
    const btn  = document.getElementById('fFilter');
    const menu = document.getElementById('filterMenu');
    if (menu){ menu.hidden = false; btn?.setAttribute('aria-expanded','true'); }

    // 포커스는 패널 내 첫 요소로
    form?.querySelector('select, input')?.focus();
  });
}

/* =========================
 * 새로고침(데이터 로드→검색 반영)
 * ========================= */
async function refresh(){
  await loadFavSet();
  const [uid, admin, appliedSet] =
    await Promise.all([ currentUid(), isAdmin(), myAppliedMap() ]);
  __uid = uid; __admin = admin; __appliedSet = appliedSet;

  //if (!window.__sportFilterBuilt){ renderSportFilter(); window.__sportFilterBuilt = true; }
  if (!window.__searchBound){ bindSearchEvents(); window.__searchBound = true; }

  await applySearchAndFilters(); // ← await 필수
}
/* =========================
 * 이벤트 위임: 등록/즐겨찾기/위치/신청/삭제
 * ========================= */
let openingPost = false;
document.addEventListener('click', async (e)=>{
  if (e.target.closest('#openPost')){
    if (openingPost) return; openingPost = true;
    try{
      const { data:{ session } } = await supabase.auth.getSession();
      if (!session){
        if (confirm('로그인이 필요합니다.\n로그인 페이지로 이동하시겠습니까?')){ location.href = `/mypage.html?next=${encodeURIComponent('/dailyprograms.html')}`; }
        return;
      }
      const dlg = document.getElementById('postModal');
      if (dlg){
        if (typeof dlg.showModal==='function') dlg.showModal(); else dlg.setAttribute('open','');
        renderSportField(); document.getElementById('sportType')?.addEventListener('change', syncOther); syncOther();
        setMinToday();
        const $s = document.getElementById('start');
        const $e = document.getElementById('end');
        $s?.addEventListener('input', validateRange);
        $e?.addEventListener('input', validateRange);
      } else { alert('작성 모달이 없습니다. <dialog id="postModal">를 확인하세요.'); }
    }finally{ setTimeout(()=> openingPost=false, 50); }
    return;
  }

  const $list = document.getElementById('dailyList'); if (!$list) return;
  const card = e.target.closest('.card'); if (!card || !$list.contains(card)) return;
  const moreBtn = e.target.closest('.more-btn');
  if (moreBtn){
    e.preventDefault(); e.stopPropagation();
    openMoreMenu(moreBtn);
    return;
  }

  const favBtn = e.target.closest('button[data-fav]');
  if (favBtn){
    const { data:{ session } } = await supabase.auth.getSession();
    if (!session){
      if (confirm('로그인이 필요합니다.\n로그인 페이지로 이동하시겠습니까?')){ location.href = `/mypage.html?next=${encodeURIComponent('/dailyprograms.html')}`; }
      return;
    }
    __session = session;
    const postId = Number(favBtn.dataset.fav); if(!Number.isFinite(postId)) return;
    const pressed = favBtn.getAttribute('aria-pressed') === 'true';
    setFavUI(favBtn, !pressed);
    try{
      if(!pressed){
        const { error } = await supabase.from('daily_favorites').insert({ user_id: __session.user.id, post_id: postId });
        if(error) throw error; __favSet.add(String(postId));
      }else{
        const { error } = await supabase.from('daily_favorites').delete().eq('user_id', __session.user.id).eq('post_id', postId);
        if(error) throw error; __favSet.delete(String(postId));
      }
    }catch(err){ setFavUI(favBtn, pressed); alert('즐겨찾기 처리에 실패했습니다.'); }
    return;
  }

  if (e.target.closest('button.primary')){
    postToMap({ type:'ADD_MARKER_BY_ADDRESS', payload:{ id: card.dataset.id, address: norm(card.dataset.address), title: card.dataset.title, center: true, zoom: 12, icon: iconFor(card.dataset.type) } });
    card.classList.add('is-active'); setTimeout(()=>card.classList.remove('is-active'), 1200);
    return;
  }

  const applyBtn = e.target.closest('[data-act="apply"]');
  if (applyBtn){
    if (applyBtn.disabled || /정원 마감|신청 완료/.test(applyBtn.textContent)) return;

    const { data:{ session } } = await supabase.auth.getSession();
    if (!session){
      if (confirm('로그인이 필요합니다.\n로그인 페이지로 이동하시겠습니까?')){
        location.href = `/mypage.html?next=${encodeURIComponent('/dailyprograms.html')}`;
      }
      return;
    }

    const postId = Number(card.dataset.id);
    if (!Number.isFinite(postId)) return;
    if (card.dataset.user === session.user.id){
      alert('본인 모집글에는 신청할 수 없습니다.');
      return;
    }
    
    
    const mode = (card.dataset.mode || 'selection');
    let msg = null;
    if (mode === 'selection') {
      msg = prompt('신청 메시지를 입력하세요. (선택)');
      if (msg === null) return; 
    }

    applyBtn.disabled = true;
    try {
      const { data, error } = await supabase.rpc('submit_application', {
        p_post_id: postId,
        p_message: msg || null,
      });
      if (error) throw error;

      if ((mode === 'fcfs') || data?.status === 'accepted') alert('신청이 즉시 확정되었습니다.');
      else alert('신청이 접수되었습니다.');

      applyBtn.textContent = '신청 완료';
      await refresh();
    } catch (err) {
      alert(err.message || '신청 중 오류가 발생했습니다.');
      applyBtn.disabled = false;
    }
    return;
  }

  const delBtn = e.target.closest('button.del');
  if (delBtn){
    const id = Number(delBtn.dataset.id);
    if (!Number.isFinite(id)) return;
    if (!confirm('삭제하시겠습니까?')) return;

    let error;
    if (__admin) {
      // 관리자: RLS "admin delete" policy를 타게 테이블 삭제
      ({ error } = await supabase
        .from('daily_posts')
        .delete()
        .eq('id', id));
    } else {
      // 작성자: RPC 사용
      ({ error } = await supabase.rpc('host_delete_post', { p_post_id: id }));
    }

    if (error){ alert(error.message); return; }
    await refresh();
    return;
  }
});

/* =========================
 * 모달 바깥 클릭 닫기
 * ========================= */
document.getElementById('postModal')?.addEventListener('click',(e)=>{
  const dlg=e.currentTarget, r=dlg.getBoundingClientRect();
  const inside = e.clientX>=r.left && e.clientX<=r.right && e.clientY>=r.top && e.clientY<=r.bottom;
  if (!inside) dlg.close();
});

/* =========================
 * 폼 제출 → insert
 * ========================= */
document.addEventListener('submit', async (e)=>{
  if (!validateRange()){
    // 이때만 브라우저 팝업 노출
    document.getElementById('start')?.reportValidity();
    document.getElementById('end')?.reportValidity();
    return;
  }
  if (e.target?.id !== 'dailyForm') return;
  e.preventDefault();

  const fd = new FormData(e.target);
  const sel = document.getElementById('sportType');
  const otherInp = document.getElementById('sportOther');
  const type = sel?.value || '';
  const sportLabel = (type === 'other') ? norm(otherInp?.value || '') : (sel?.options[sel.selectedIndex]?.text || '');
  const recruitMode = (document.getElementById('recruitMode')?.value === 'fcfs') ? 'fcfs' : 'selection';
  const difficulty  = document.getElementById('difficulty')?.value || 'normal';
  const address = norm(fd.get('address')); const start = fd.get('start'); const end = fd.get('end');

  if (!sportLabel || !address || !start || !end){ alert('필수 항목을 입력해 주세요.'); return; }
  if (type === 'other' && !norm(otherInp?.value)){ alert('기타 종목명을 입력해 주세요.'); return; }

  const { data:{ session } } = await supabase.auth.getSession();
  if (!session){
    if (confirm('로그인이 필요합니다.\n로그인 페이지로 이동하시겠습니까?')){ location.href = `/mypage.html?next=${encodeURIComponent('/dailyprograms.html')}`; }
    return;
  }

  const capRaw = String(fd.get('capacity')||'').trim();
  const capacity = capRaw ? Number(capRaw) : null;

  const row = {
    user_id: session.user.id,
    type,
    sport_label: sportLabel,
    address,
    start: new Date(start).toISOString(),
    end:   new Date(end).toISOString(),
    capacity,
    host: norm(fd.get('host')),
    note: norm(fd.get('note')),
    contact: norm(fd.get('contact')),
    recruit_mode: recruitMode,
    difficulty
  };

  const { error } = await supabase.from('daily_posts').insert(row);
  if (error){ alert(error.message); return; }

  document.getElementById('postModal')?.close();
  await refresh();

  postToMap({ type:'ADD_MARKER_BY_ADDRESS', payload:{ id:'(new)', address, title:`${sportLabel} (${row.host||'주최'})`, center:true, zoom:12, icon:iconFor(type) } });

  e.target.reset(); syncOther();
});

/* =========================
 * 초기 로드
 * ========================= */
window.addEventListener('message',(e)=>{ if (e.data?.type==='MAP_READY') refresh(); });
document.addEventListener('DOMContentLoaded', ()=> refresh());
