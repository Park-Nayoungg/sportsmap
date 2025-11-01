// /js/compose.js
import { supabase } from './supabase.client.js';
const $ = (s, r=document)=>r.querySelector(s);

const ALLOWED = ['image/jpeg','image/png','image/webp','image/gif'];
const MAX_FILES = 5;
const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const BUCKET = 'post-images';

async function createPost({ title, body_md, tags=[], images=[], visibility='public' }){
  const { data, error } = await supabase.rpc('create_post', {
    p_title: title,
    p_body_md: body_md,
    p_images: images,
    p_tags: tags,
    p_visibility: visibility
  });
  if (error) throw error;
  return data;
}

function renderPreviews(files){
  const wrap = $('#preview'); wrap.innerHTML = '';
  files.forEach(f=>{
    const url = URL.createObjectURL(f);
    const img = new Image(); img.src = url; img.alt = f.name; img.style.width='100%'; img.style.borderRadius='8px';
    wrap.appendChild(img);
  });
}
function validateFiles(files){
  const arr = Array.from(files||[]);
  if (arr.length > MAX_FILES) throw new Error(`최대 ${MAX_FILES}장까지 업로드 가능합니다.`);
  for (const f of arr){
    if (!ALLOWED.includes(f.type)) throw new Error('jpg/png/webp/gif만 업로드 가능합니다.');
    if (f.size > MAX_SIZE) throw new Error(`한 장당 최대 ${Math.round(MAX_SIZE/1024/1024)}MB까지 허용됩니다.`);
  }
  return arr;
}
async function uploadImages(files){
  const { data:{ session } } = await supabase.auth.getSession();
  if (!session?.user?.id) throw new Error('로그인 후 사진을 업로드해 주세요.');
  const uid = session.user.id;

  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth()+1).padStart(2,'0');

  const out = [];
  for (const f of files){
    const ext = (f.name.split('.').pop() || 'png').toLowerCase();
    const key = `${uid}/${y}/${m}/${crypto.randomUUID()}.${ext}`;

    const { error } = await supabase.storage.from('post-images')
      .upload(key, f, { contentType: f.type, cacheControl: '3600', upsert: false });
    if (error) throw error;

    const { data } = supabase.storage.from('post-images').getPublicUrl(key);
    out.push(data.publicUrl);
  }
  return out;
}

document.addEventListener('DOMContentLoaded', async ()=>{
  const { data:{ session } } = await supabase.auth.getSession();
  if (!session?.user) { location.href = `./login.html?redirect=${encodeURIComponent(location.href)}`; return; }
  const form = $('#composeForm');
  const sel  = $('#topic');
  const ti   = $('#title');
  const bd   = $('#body');
  const fac  = $('#facility');
  const btn  = $('#btnSubmit');
  const file = $('#images');

  // 프리필
  const params = new URLSearchParams(location.search);
  const pf = params.get('q') || params.get('facility') || '';
  if (pf && !fac.value) fac.value = pf;

  // 마지막 주제
  const last = localStorage.getItem('comm.lastTopic');
  if (last && ['일반','후기','이벤트'].includes(last)) sel.value = last;

  // 미리보기
  file?.addEventListener('change', ()=>{
    try{ renderPreviews(validateFiles(file.files)); }catch(e){ alert(e.message); file.value=''; $('#preview').innerHTML=''; }
  });

  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const topic = sel.value || '일반';
    const bodyText = String(bd.value||'').trim();
    if (!bodyText){ alert('내용을 입력해 주세요.'); bd.focus(); return; }

    // 업로드
    let files = [];
    try{ files = validateFiles(file.files); }catch(e){ alert(e.message); return; }
    btn.disabled = true;

    try{
      const imageUrls = await uploadImages(files); // ← 공개 URL 배열
      const titleText = (ti.value||'').trim() || bodyText.split('\n')[0].slice(0,30) || topic;

      const tags = [`주제:${topic}`];
      const facName = fac.value.trim();
      if (facName) tags.push(`시설:${facName}`);

      // 본문 끝에 시설명 노출(표기 형태는 취향대로)
      const bodyForSave = facName ? `${bodyText}\n\n[시설] ${facName}` : bodyText;
      const titleWithFac = titleText || (facName ? `${facName} 관련` : topic);
      const id = await createPost({
        title: titleWithFac,
        body_md: bodyForSave,
        tags,
        images: imageUrls,          // ← 저장
        visibility: 'public'
      });

      localStorage.setItem('comm.lastTopic', topic);
      location.href = `./community.html#p-${id}`;
    }catch(err){
      alert(err.message || '등록 실패');
    }finally{
      btn.disabled = false;
    }
  });
});