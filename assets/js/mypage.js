// mypage.js
import { supabase } from './supabase.client.js';
let __lastUid;                 // 마지막으로 반영한 사용자
let __firstAuthEventHandled = false;  // onAuthStateChange 첫 null 무시용
const NICK_RE = /^[A-Za-z0-9가-힣 _\-\[\]\(\)·\.]+$/; //닉네임 규정

//즐겨찾기 관련

function pad(n){ return String(n).padStart(2,'0'); }
function fmtRange(s,e){
  if(!s||!e) return '';
  const a=new Date(s), b=new Date(e);
  return `${a.getMonth()+1}/${a.getDate()} ${pad(a.getHours())}:${pad(a.getMinutes())} ~ ${pad(b.getHours())}:${pad(b.getMinutes())}`;
}
function esc(t){ return String(t||'').replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' }[m])); }

export async function loadFavMini(limit=5){
  const wrap = document.getElementById('favMiniList');
  if(!wrap) return;

  const { data:{ session } } = await supabase.auth.getSession();
  if(!session){
    wrap.innerHTML = `<p class="meta">로그인 후 이용하세요.</p>`;
    return;
  }

  // 즐겨찾기 ↔ 글 조인(상위 N개)
  const { data, error } = await supabase
    .from('daily_favorites')
    .select('created_at, post_id, daily_posts!inner(id,sport_label,address,start,end)')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending:false })
    .limit(limit);

  if(error){
    console.error(error);
    wrap.innerHTML = `<p class="meta">불러오기 실패</p>`;
    return;
  }
  if(!data?.length){
    wrap.innerHTML = `<p class="meta">즐겨찾기한 프로그램이 없습니다.</p>`;
    return;
  }

  wrap.innerHTML = data.map(r=>{
    const p = r.daily_posts;
    const ttl = `${esc(p.sport_label||'프로그램')} · ${esc(p.address||'')}`;
    const when = fmtRange(p.start, p.end);
    return `
      <div class="mini-item">
        <div class="mini-col">
          <div class="mini-ttl">${ttl}</div>
          <div class="mini-meta">${esc(when)}</div>
        </div>
        <a class="chev-btn" href="./dailyprograms.html#prog-${p.id}" aria-label="목록에서 보기">›</a>
      </div>`;
  }).join('');
}
//알림관련
function setNotifBadge(n){
  const el = document.getElementById('notifBadge');
  if(!el) return;
  if(n > 0){ el.hidden = false; el.textContent = n > 99 ? '99+' : String(n); }
  else { el.hidden = true; el.textContent = '0'; }
}
async function fetchUnreadCount(){
  const { data:{ session } } = await supabase.auth.getSession();
  if(!session) return 0;
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count:'exact', head:true })
    .eq('recipient_id', session.user.id)
    .is('read_at', null);
  return error ? 0 : (count ?? 0);
}
function gotoNextIfSaved() {
  const next = localStorage.getItem('auth.next');
  if (next) {
    localStorage.removeItem('auth.next');
    location.href = next;
    return true;
  }
  return false;
}
async function bootBadge(){
  // 1) 로컬 캐시 표시
  setNotifBadge(Number(localStorage.getItem('notif.unreadCount')||0));

  // 2) 세션 즉시 확인
  const { data:{ session } } = await supabase.auth.getSession();
  if (session){
    try{ setNotifBadge(await fetchUnreadCount()); }catch{}
    return;
  }

  // 3) 로그인 완료 신호 대기 후 1회 갱신
  const { data:{ subscription } } = supabase.auth.onAuthStateChange(async (event, sess)=>{
    if(event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED'){
      try{ setNotifBadge(await fetchUnreadCount()); }catch{}
      subscription.unsubscribe();
    }
  });
}
// 이름 읽기: profiles.full_name → profiles.fullname → 세션 메타 순
const readName = (sess, prof) =>
  prof?.full_name ?? prof?.fullname ??
  sess?.user?.user_metadata?.full_name ?? sess?.user?.user_metadata?.fullname ?? '';

//폰트 크기변경
let setFS = window.__setFontScale;
try {
  if (!setFS) {
    const mod = await import('./common.js');
    setFS = mod.setFontScale;
  }
} catch (_) {}
if (typeof setFS !== 'function') {
  const MIN_SCALE = MIN_PT / 12;
  const MAX_SCALE = MAX_PT / 12;

  setFS = (scale) => {
    const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(scale) || 1));
    const de = document.documentElement;
    // CSS 변수 + html font-size 동시 적용 → iOS 즉시 반영
    de.style.setProperty('--font-scale', String(s));
    de.style.fontSize = (16 * s) + 'px';
    // 저장
    try { localStorage.setItem('ui.fontScale', String(s)); } catch {}
    // iOS 강제 리플로우
    void de.offsetHeight;
    // 전역 노출
    window.__setFontScale = setFS;
    return s;
  };
}
const DEFAULT_PT = 12, MIN_PT = 8, MAX_PT = 30, STEP_PT = 1;
const ptToScale = pt => pt / 12;
const scaleToPt = s => s * 12;

document.addEventListener('DOMContentLoaded', async () => {
  await bootBadge();
  const range   = document.getElementById('fontRange');
  const val     = document.getElementById('fontVal');
  const help    = document.getElementById('fontHelp');
  const btnSave = document.getElementById('fontSave');
  const btnReset= document.getElementById('fontReset');
  const btnMinus= document.getElementById('fontMinus');
  const btnPlus = document.getElementById('fontPlus');

  // ▼ 폰트 슬라이더 영역만 조건 처리
  if (range && setFS) {
    range.min = String(MIN_PT);
    range.max = String(MAX_PT);
    range.step = String(STEP_PT);

    const saved = parseFloat(localStorage.getItem('ui.fontScale')||'1');
    const initPt = Math.min(MAX_PT, Math.max(MIN_PT, scaleToPt(Number.isFinite(saved)?saved:1)));
    range.value = String(initPt);

    const reflectLabel = (pt)=>{ val.textContent = `${pt.toFixed(0)}pt`; help.textContent = `현재 1rem ≈ ${(16*ptToScale(pt)).toFixed(0)}px`; range.setAttribute('aria-valuenow', String(pt)); };
    const applyScale = (pt)=>{ const s = ptToScale(Math.min(MAX_PT, Math.max(MIN_PT, pt))); setFS(s); reflectLabel(pt); };

    applyScale(parseFloat(range.value));

    const lockScroll = ()=> document.body.classList.add('body-no-scroll');
    const unlockScroll = ()=> document.body.classList.remove('body-no-scroll');

    range.addEventListener('pointerdown', lockScroll, {passive:true});
    range.addEventListener('touchstart',  lockScroll, {passive:true});
    range.addEventListener('mousedown',   lockScroll, {passive:true});

    range.addEventListener('input', () => reflectLabel(parseFloat(range.value)));

    const end = ()=>{ applyScale(parseFloat(range.value)); unlockScroll(); };
    range.addEventListener('pointerup', end, {passive:true});
    range.addEventListener('touchend',  end, {passive:true});
    range.addEventListener('mouseup',   end, {passive:true});
    range.addEventListener('change',    end, {passive:true});

    btnSave?.addEventListener('click', () => alert('글자 크기를 저장했습니다.'));
    btnReset?.addEventListener('click', () => { range.value = String(DEFAULT_PT); end(); });

    const step = 1;
    btnMinus?.addEventListener('click', () => { range.value = String(Math.max(MIN_PT, parseFloat(range.value)-step)); end(); });
    btnPlus ?.addEventListener('click', () => { range.value = String(Math.min(MAX_PT, parseFloat(range.value)+step)); end(); });
  }

  const loginReason = document.getElementById('loginReason');
  document.getElementById('notifBtn')?.addEventListener('click', async (e)=>{
    e.preventDefault(); e.stopPropagation();
    const s = (await supabase.auth.getSession()).data.session;
    if (s) { location.href = './notifications.html'; return; }
    localStorage.setItem('auth.next', './notifications.html');
    const r = document.getElementById('loginReason');
    if (r){ r.textContent = '*로그인이 필요한 서비스입니다.'; r.hidden = false; }
    document.getElementById('loginModal')?.showModal();
  });
  await loadFavMini(5);
});


/* ================= 인증 UI ================= */
const $ = (s)=>document.querySelector(s);
const nextParam = new URLSearchParams(location.search).get('next') || '/mypage.html';

const $out = $('#authSignedOut');
const $in  = $('#authSignedIn');

const $loginBtn  = $('#loginBtn');
const $signupBtn = $('#signupBtn');

const $dlg        = $('#loginModal');
const $closeLogin = $('#closeLogin');
const $loginForm  = $('#loginForm');

const $userEmail = $('#userEmail');
const $userNick  = $('#userNickname');
const $nickInput = $('#pf_nickname');
const $userFullname = $('#userFullname');

const $signupDlg   = $('#signupModal');
const $signupForm  = $('#signupForm');
const $closeSignup = $('#closeSignup');

/* 프로필 보장: 없으면 생성 */
async function ensureProfile(user){
  // email 컬럼 제거, 이름 컬럼 두 가지 모두 시도
  const sel = 'id,nickname,full_name,fullname';
  const { data, error } = await supabase
    .from('profiles').select(sel).eq('id', user.id).maybeSingle();
  if (!error && data) return data;

  const guessNick = user.user_metadata?.fullname
                 || user.user_metadata?.full_name
                 || (user.email ? user.email.split('@')[0] : '사용자');
  const guessName = user.user_metadata?.full_name
                 || user.user_metadata?.fullname
                 || null;

  // full_name 우선 업서트 → fullname 보조
  const { data: up } = await supabase
    .from('profiles')
    .upsert({ id:user.id, nickname:guessNick, full_name:guessName, fullname:guessName }, { onConflict:'id' })
    .select(sel).maybeSingle();
  return up;
}

/* 관리자 여부 */
async function amIAdmin(){
  try{
    const { data, error } = await supabase.rpc('is_admin');
    if (error) return false;
    return !!data;
  }catch{ return false; }
}
function reflectAdminUI(isAdmin){
  document.querySelectorAll('.admin-only').forEach(el=>{
    el.style.display = isAdmin ? 'flex' : 'none';
  });
}
/* 표시 전환 */
function showSection(session){
  const signedIn = !!session;
  if ($out) $out.hidden = signedIn;
  if ($in)  $in.hidden  = !signedIn;

  if (signedIn) {
    const metaName = session.user?.user_metadata?.full_name
                  || session.user?.user_metadata?.fullname || '';
    if ($userFullname && !$userFullname.textContent) $userFullname.textContent = metaName;
    $userEmail.textContent = session.user?.email || '(이메일 없음)';
  } else {
    $userEmail.textContent = '-';
    if ($userNick)  $userNick.textContent = '';
    if ($nickInput) $nickInput.value = '';
    if ($userFullname) $userFullname.textContent = '';
    reflectAdminUI(false);            // ★ 로그아웃 시 관리자 카드 숨김
  }
}

/* 프로필 로드 */
async function loadProfile(uid){
  const sel = 'nickname,full_name,fullname';
  const { data, error } = await supabase
    .from('profiles').select(sel).eq('id', uid).maybeSingle();
  if (!error){
    const nick = data?.nickname || '';
    if ($nickInput) $nickInput.value = nick;
    if ($userNick)  $userNick.textContent = nick ? ` ${nick}` : '';
    if ($userFullname){
      const sess = (await supabase.auth.getSession()).data.session;
      $userFullname.textContent = readName(sess, data);
    }
  }
}

/* 로그아웃 전용 바인딩 */
function bindLogout() {
  const old = document.getElementById('logoutBtn');
  if (!old) return;
  old.replaceWith(old.cloneNode(true));           // 중복 제거
  const btn = document.getElementById('logoutBtn');
  if (!btn) return;

  btn.addEventListener('click', async (ev)=>{
    ev.preventDefault(); ev.stopPropagation();
    console.log('[logout] start');

    const timeout = (ms)=> new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')), ms));

    async function doSignOut() {
      try {
        const p1 = supabase.auth.signOut({ scope:'local' });
        await Promise.race([p1, timeout(3000)]);
        console.log('[logout] local done');
        return;
      } catch (e1) {
        console.warn('[logout] local fail:', e1?.message);
      }
      try {
        const p2 = supabase.auth.signOut({ scope:'global' });
        await Promise.race([p2, timeout(3000)]);
        console.log('[logout] global done');
        return;
      } catch (e2) {
        console.warn('[logout] global fail:', e2?.message);
      }
      try {
        Object.keys(localStorage).filter(k=>k.startsWith('sb-')).forEach(k=>localStorage.removeItem(k));
        console.log('[logout] cleared sb-* from localStorage');
      } catch {}
    }

    try { await doSignOut(); } catch {}
    try { showSection(null); } catch {}
    location.reload();                           // 캐시/세션 싱크 보정
  });
}

// 비밀번호 보기: 누르고 있는 동안만 표시
const form = document.getElementById('signupForm');
const pw = document.getElementById('password');
const pwc = document.getElementById('passwordConfirm');
const peek = form.querySelector('.pw-peek');
const help = document.getElementById('pwHelp');

function showPw(){ pw.type = 'text'; peek.setAttribute('aria-pressed','true'); }
function hidePw(){ pw.type = 'password'; peek.setAttribute('aria-pressed','false'); }

peek.addEventListener('mousedown', showPw);
peek.addEventListener('mouseup', hidePw);
peek.addEventListener('mouseleave', hidePw);
peek.addEventListener('touchstart', (e)=>{ e.preventDefault(); showPw(); }, {passive:false});
peek.addEventListener('touchend', hidePw);

// 비밀번호 일치 검사
function checkMatch(){
  if (pwc.value && pwc.value !== pw.value){
    pwc.setCustomValidity('비밀번호가 일치하지 않습니다.');
    help.textContent = '비밀번호가 일치하지 않습니다.';
  } else {
    pwc.setCustomValidity('');
    help.textContent = '';
  }
}
pw.addEventListener('input', checkMatch);
pwc.addEventListener('input', checkMatch);

// 제출 시 유효성
form.addEventListener('submit', (e)=>{
  checkMatch();
  if(!form.checkValidity()){
    e.preventDefault();
    form.reportValidity();
  }
});

/* 프로필 저장 바인딩 */
function bindProfileSave(){
  const old = document.getElementById('pf_save');
  if (!old) return;
  old.replaceWith(old.cloneNode(true));
  const btn = document.getElementById('pf_save');
  if (!btn) return;

  btn.addEventListener('click', async (ev)=>{
    ev.preventDefault(); ev.stopPropagation();
    const { data:{ session } } = await supabase.auth.getSession();
    if (!session) { alert('로그인이 필요합니다.'); return; }

    let nicknameRaw = ($nickInput?.value || '').replace(/\s+/g,' ').trim();
    if (nicknameRaw.length < 2 || nicknameRaw.length > 20) {
      alert('닉네임은 2~20자여야 합니다.'); return;
    }
    const isAdmin = await amIAdmin();
    if (!isAdmin) {
      // 비관리자는 '[관리자]' 또는 '관리자' 입력 못하게 함
      if (nicknameRaw === '[관리자]' || nicknameRaw.toLowerCase() === '관리자') {
        alert('해당 닉네임은 사용할 수 없습니다.');
        return;
      }
    }

    if (!NICK_RE.test(nicknameRaw)) {
      alert('사용 가능한 문자만 입력하세요.\n(한글/영문/숫자, 공백, _ - [ ] ( ) · .)'); return;
    }

    const { error } = await supabase.from('profiles').upsert({
      id: session.user.id, nickname: nicknameRaw
    });
    if (error) {
      if (String(error.code)==='23505') { alert('이미 사용 중인 닉네임입니다.'); return; }
      alert(error.message || '저장 실패'); return;
    }
    const { data: rd } = await supabase.from('profiles')
      .select('nickname,full_name,fullname').eq('id', session.user.id).maybeSingle();

    const finalNick = rd?.nickname || nicknameRaw;
    $userNick && ($userNick.textContent = finalNick ? ` · ${finalNick}` : '');
    $nickInput && ($nickInput.value = finalNick || '');
    if ($userFullname) $userFullname.textContent = readName(session, rd);
    alert('저장되었습니다.');
  });
}

/* 세션 반영 */
async function afterSignIn(session){
  const uid = session?.user?.id || null;
  if (uid && uid === __lastUid) return;
  __lastUid = uid;

  showSection(session);

  if (session){
    await ensureProfile(session.user);
    await loadProfile(session.user.id);

    try{
      const admin = await amIAdmin();
      reflectAdminUI(!!admin);        // ★ 관리자 카드 표시/숨김

      if (admin){
        if ($nickInput){ $nickInput.value='[관리자]'; $nickInput.disabled=true; }
        const btn = document.getElementById('pf_save');
        if (btn){ btn.hidden=true; btn.title='관리자 닉네임은 고정됩니다.'; }
        if ($userNick) $userNick.textContent = '[관리자]';
      }
    }catch{}
  }

  bindLogout();
  bindProfileSave();
  await loadFavMini(5);
}

/* 초기 세션 */
supabase.auth.getSession().then(({ data:{ session } })=> afterSignIn(session));

/* 로그인 모달 */
$loginBtn?.addEventListener('click', ()=>{
  if (!$dlg) return;
  if (typeof $dlg.showModal === 'function') $dlg.showModal();
  else $dlg.setAttribute('open','');
});
$closeLogin?.addEventListener('click', ()=> $dlg?.close());
$dlg?.addEventListener('click', (e)=>{
  const r = $dlg.getBoundingClientRect();
  const inside = e.clientX>=r.left && e.clientX<=r.right && e.clientY>=r.top && e.clientY<=r.bottom;
  if (!inside) $dlg.close();
});

/* 로그인 제출 */
$loginForm?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const fd = new FormData($loginForm);
  const email = fd.get('email'); const password = fd.get('password');
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error){ alert(error.message); return; }
  const { data:{ session } } = await supabase.auth.getSession();
  await afterSignIn(session);
  if (gotoNextIfSaved()) return;
  $dlg?.close();
});

/* 회원가입 이동 */
$signupBtn?.addEventListener('click', ()=>{
  if (typeof $signupDlg?.showModal === 'function') $signupDlg.showModal();
  else $signupDlg?.setAttribute('open','');
});
$closeSignup?.addEventListener('click', ()=> $signupDlg?.close());
$signupDlg?.addEventListener('click', (e)=>{
  const r = $signupDlg.getBoundingClientRect();
  const inside = e.clientX>=r.left && e.clientX<=r.right && e.clientY>=r.top && e.clientY<=r.bottom;
  if (!inside) $signupDlg.close();
});

$signupForm?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const fd = new FormData($signupForm);
  const email     = String(fd.get('email')||'').trim();
  const password  = String(fd.get('password')||'').trim();
  const fullname  = String(fd.get('fullname')||'').trim();   // 표시용 입력값
  const birthdate = String(fd.get('birthdate')||'').trim();

  // 검증
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { alert('올바른 이메일을 입력해 주세요.'); return; }
  if (!password || password.length < 6) { alert('비밀번호는 6자 이상이어야 합니다.'); return; }
  if (!fullname || fullname.length < 2 || fullname.length > 30) { alert('이름은 2~30자로 입력해 주세요.'); return; }
  if (birthdate && !/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) { alert('생년월일 형식이 올바르지 않습니다.'); return; }

  // 회원가입
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${location.origin}/auth/callback.html?next=${encodeURIComponent('/mypage.html')}`,
      data: { fullname, birthdate }
    }
  });
  if (error) {
    if ((error.status === 422) || /already/i.test(error.message)) alert('이미 가입된 이메일입니다.');
    else alert(error.message || '회원가입 실패');
    return;
  }

  // 프로필 upsert: email 컬럼 제외, 이름 컬럼 둘 다 세팅
  try {
    const userId = data.user?.id;
    if (userId) {
      await supabase.from('profiles').upsert({
        id: userId,
        nickname: fullname,           // 초기 닉네임 = 이름
        full_name: fullname,
        fullname: fullname,
        birthdate: birthdate || null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });
    }
  } catch {}

  // 자동 로그인 처리
  const { data:{ session } } = await supabase.auth.getSession();
  if (session) {
    await (async()=>{ showSection(session); await loadProfile(session.user.id); })();
  } else {
    alert('가입이 완료되었습니다. 이메일 인증 후 자동 로그인됩니다.');
  }
  $signupDlg?.close();
});

/* DOM 준비 시 버튼 바인딩 1차 */
document.addEventListener('DOMContentLoaded', ()=>{
  bindLogout();
  bindProfileSave();
});

supabase.auth.getSession().then(({ data:{ session } }) => afterSignIn(session));

/* 상태 변경 동기화 */
supabase.auth.onAuthStateChange((_e, session)=>{
  // 첫 이벤트가 null이면 무시하여 UI 초기화 방지
  if (!__firstAuthEventHandled && !session){
    __firstAuthEventHandled = true;
    return;
  }
  __firstAuthEventHandled = true;
  afterSignIn(session);
  if (session) gotoNextIfSaved();
});

