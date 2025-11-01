import { supabase } from './supabase.client.js';

const msg = (t)=>{ const el=document.getElementById('msg'); if(el) el.textContent=t; };
const params = new URLSearchParams(location.search);
const next = params.get('next') || '/mypage.html';

// 1) 신규 링크(쿼리에 code) 처리
const code = params.get('code');
if (code) {
  (async ()=>{
    try {
      await supabase.auth.exchangeCodeForSession(code);
      msg('세션이 설정되었습니다.');
    } catch (e) {
      msg('세션 설정 실패: ' + (e?.message||''));
    } finally {
      location.replace(next);
    }
  })();
} else {
  // 2) 구형 링크(해시에 access_token) 처리
  const hash = new URLSearchParams(location.hash.slice(1));
  const access_token  = hash.get('access_token');
  const refresh_token = hash.get('refresh_token');
  if (access_token && refresh_token) {
    (async ()=>{
      try {
        const { error } = await supabase.auth.setSession({ access_token, refresh_token });
        if (error) throw error;
        msg('세션이 설정되었습니다.');
      } catch (e) {
        msg('세션 설정 실패: ' + (e?.message||''));
      } finally {
        location.replace(next);
      }
    })();
  } else {
    // 아무 토큰도 없으면 바로 이동
    location.replace(next);
  }
}
