// common.js ─ 모든 페이지 공통 + (메인 화면용 지도 연동 포함)
function idForCard(card){
  return card.dataset.id
      || (card.dataset.title ? `title:${card.dataset.title.trim()}` : '')
      || (card.dataset.address ? `addr:${card.dataset.address.trim().replace(/\s+/g,' ')}` : '');
}
window.idForCard = idForCard;

// 모달 닫을 때 안내문 숨김(선택)
document.getElementById('closeLogin')?.addEventListener('click', () => {
  const p = document.getElementById('loginReason'); if (p) p.hidden = true;
});
function safeGetIconForCard(card){
  return (typeof window.getIconForCard === 'function') ? window.getIconForCard(card) : null;
}

(function bootFontScale(){
  const s = localStorage.getItem('ui.fontScale') || '1';
  document.documentElement.style.setProperty('--font-scale', s);
})();


export function setFontScale(v){
  document.documentElement.style.setProperty('--font-scale', String(v));
  localStorage.setItem('ui.fontScale', String(v));
}

if (typeof window !== 'undefined') window.__setFontScale = setFontScale;


document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.bottom-nav a').forEach(a => {
    if (location.pathname.endsWith(a.getAttribute('href'))) a.classList.add('active');
  });
});

document.addEventListener('DOMContentLoaded', () => {
  const iframe = document.getElementById('mapFrame');
  if (!iframe) return; 

  let mapWin = null;

  const SAME_ORIGIN = (location.origin && location.origin !== 'null') ? location.origin : '*';

  function sendToMap(msg){
    if (!mapWin) return;
    mapWin.postMessage(msg, SAME_ORIGIN);
  }

  iframe.addEventListener('load', () => {
    mapWin = iframe.contentWindow;

    sendToMap({ type: 'SET_CENTER', payload: { lat: 37.5665, lng: 126.9780, zoom: 13 } });
  });


  function wireCardClicks(rootId){
    const root = document.getElementById(rootId);
    if (!root) return;

    root.addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (!card) return;

      const id    = idForCard(card);
      const title = card.dataset.title || card.querySelector('h3')?.textContent || '위치';
      const icon  = safeGetIconForCard(card);
      const addr  = card.dataset.address?.trim();

      if (addr) {
        sendToMap({
          type: 'ADD_MARKER_BY_ADDRESS',
          payload: { id, address: addr, title, icon: icon || undefined, center: true, zoom: 16 } 
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      const lat = parseFloat(card.dataset.lat);
      const lng = parseFloat(card.dataset.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        sendToMap({ type: 'ADD_MARKER', payload: { id, lat, lng, title, icon, center: true, zoom: 16 } });
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  }

  function findCardByIdOrTitle({ id, title }) {
    const cards = document.querySelectorAll('.card');
    if (id) {
      for (const c of cards) if (c.dataset.id === id) return c;
    }
    if (title) {
      for (const c of cards) {
        const t = c.dataset.title || c.querySelector('h3')?.textContent?.trim();
        if (t === title) return c;
      }
    }
    return null;
  }

  function scrollCardToTop(card) {
    const header = document.querySelector('header');
    const offset = (header?.offsetHeight || 0) + 8; 

    const content = document.querySelector('.content');
    const cs = content ? getComputedStyle(content) : null;
    const scrollable =
      content && (/(auto|scroll)/.test(cs.overflowY) || /(auto|scroll)/.test(cs.overflow));

    if (scrollable) {
      const cRect = content.getBoundingClientRect();
      const elRect = card.getBoundingClientRect();
      const nextTop = elRect.top - cRect.top + content.scrollTop - 8;
      content.scrollTo({ top: nextTop, behavior: 'smooth' });
    } else {
      const top = card.getBoundingClientRect().top + window.pageYOffset - offset;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  }

  function highlightCard(card) {
    card.classList.add('is-active');
    setTimeout(() => card.classList.remove('is-active'), 1600);
  }
  function raiseCardInList(card){
    const list = card.closest('.list');
    if (!list) return;
    const first = list.firstElementChild;
    if (first === card) return;

    const start = card.getBoundingClientRect();   
    list.insertBefore(card, first);         
    const end = card.getBoundingClientRect();     

    const dx = start.left - end.left;
    const dy = start.top  - end.top;

    card.style.transform  = `translate(${dx}px, ${dy}px)`;
    card.style.willChange = 'transform';
    requestAnimationFrame(()=>{
      card.style.transition = 'transform 220ms cubic-bezier(.22,.61,.36,1)';
      card.style.transform  = 'translate(0,0)';
    });
    card.addEventListener('transitionend', ()=>{
      card.style.transition = '';
      card.style.transform  = '';
      card.style.willChange = '';
    }, { once:true });
  }

  wireCardClicks('programList');
  wireCardClicks('seniorList');

  window.addEventListener('message', (event) => {
    if (SAME_ORIGIN !== '*' && event.origin !== SAME_ORIGIN) return;
    const { type, payload } = event.data || {};
    if (type === 'MAP_READY') {}
    if (type === 'MARKER_CLICK') {
      console.log('마커 클릭:', payload);
      const card = findCardByIdOrTitle(payload);
      if (!card) return;
      raiseCardInList(card);  
      highlightCard(card);
    }
  });

});


import { supabase } from './supabase.client.js';

if (typeof window !== 'undefined') {
  // 전역에서 현재 세션 빠르게 얻기용
  window.__getSession = async () => (await supabase.auth.getSession()).data.session || null;

  // 로그인 상태 변화 감지 → 필요한 페이지에서만 활용
  supabase.auth.onAuthStateChange((_e, _s) => {
    document.body.dataset.auth = _s ? 'in' : 'out';
  });

  // 최초 표시용
  (async () => {
    const s = await window.__getSession();
    document.body.dataset.auth = s ? 'in' : 'out';
  })();
}

async function requireAuth(reason = '로그인이 필요한 서비스입니다.') {
  const getSession = window.__getSession;
  const session = getSession ? await getSession() : null;
  if (session) return true;

  // 모달 열기 + 붉은 안내 문구 표시
  const p = document.getElementById('loginReason');
  if (p) { p.textContent = `* ${reason}`; p.hidden = false; }
  const dlg = document.getElementById('loginModal');
  if (dlg?.showModal) dlg.showModal(); else alert(reason);
  return false;
}
window.requireAuth = requireAuth;

// 모달 닫힐 때 안내 문구 숨김
document.getElementById('loginModal')?.addEventListener('close', () => {
  const p = document.getElementById('loginReason');
  if (p) p.hidden = true;
});

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-auth="required"]');
  if (!el) return;

  // 기본 이동/동작을 즉시 막는다
  e.preventDefault();
  e.stopPropagation();

  const reason = el.getAttribute('data-reason') || '로그인이 필요한 서비스입니다.';
  const href = el.tagName === 'A' ? el.getAttribute('href') : null;

  (async () => {
    const ok = await requireAuth(reason);
    if (ok && href) window.location.href = href; 
  })();
}, true);
