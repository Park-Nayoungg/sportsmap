// 지도 초기화
let map;
const markers = [];
const markerById = new Map();
const iconById   = new Map(); 
const ORIGIN = (window.location.origin && window.location.origin !== 'null') ? window.location.origin : '*';
const CLICK_FOCUS_ZOOM = 17;
const geocodeCache = new Map(); 

function post(msg){ window.parent.postMessage(msg, ORIGIN); }

function normAddr(s){ return String(s||'').trim().replace(/\s+/g,' '); }
function round(n,p=6){ const f=10**p; return Math.round(n*f)/f; }

function focusMapTo({ lat, lng, zoom = CLICK_FOCUS_ZOOM, duration = 400 }) {
  const pos = new naver.maps.LatLng(lat, lng);
  const ef = naver?.maps?.Easing?.easeInOutCubic;

  try {
    if (typeof map.morph === 'function') {
      const opts = { duration };
      if (typeof ef === 'function') opts.easing = ef; 
      map.morph(pos, zoom, opts);
      return;
    }
  } catch (e) {
    // morph 실패 시 폴백
  }
  if (Number.isFinite(zoom)) map.setZoom(zoom, true);
  map.panTo(pos);
}

function waitGeocoderReady(){
  return new Promise(r=>{
    const t = setInterval(()=>{
      if (window.naver?.maps?.Service?.geocode){ clearInterval(t); r(); }
    }, 50);
  });
}

function keyOf(p){
  if (p?.id)      return String(p.id).trim();
  if (p?.title)   return `title:${String(p.title).trim()}`;
  if (p?.address) return `addr:${normAddr(p.address)}`; 
  if (p?.lat!=null && p?.lng!=null) return `${p.lat},${p.lng}`;
  return '';
}

function applyIcon(marker, icon){
  if (!icon || !icon.url) return;
  marker.setIcon({
    url: icon.url,
    size: new naver.maps.Size(icon.w||28, icon.h||40),
    anchor: new naver.maps.Point(icon.ax||14, icon.ay||40)
  });
}

function upsertMarker({ id, lat, lng, title, icon, center=false, zoom }){
  const key = keyOf({ id, title, address: undefined }); 
  const pos = new naver.maps.LatLng(lat, lng);

  if (icon && icon.url) iconById.set(key, icon);
  const fixedIcon = iconById.get(key);

  if (markerById.has(key)){
    const m = markerById.get(key);
    m.setPosition(pos);
    if (title) m.setTitle(title);     // ← 제목 갱신
    if (fixedIcon) applyIcon(m, fixedIcon);
    if (center) focusMapTo({ lat, lng, zoom });
    return m;
  }

  const m = new naver.maps.Marker({ position: pos, map, title });
  if (fixedIcon) applyIcon(m, fixedIcon);
  markerById.set(key, m);
  markers.push(m);

  naver.maps.Event.addListener(m, 'click', ()=>{
    focusMapTo({ lat, lng });
    post({ type:'MARKER_CLICK', payload:{ id:key, lat, lng, title } });
  });

  if (center) focusMapTo({ lat, lng, zoom });
  return m;
}

function setCenter({ lat, lng, zoom }){ if (zoom!=null) map.setZoom(zoom, true); map.setCenter(new naver.maps.LatLng(lat,lng)); }
function panTo({ lat, lng, zoom }){ if (zoom!=null) map.setZoom(zoom, true); map.panTo(new naver.maps.LatLng(lat,lng)); }

function fitBounds({ sw, ne, padding=20 }){
  const b = new naver.maps.LatLngBounds(
    new naver.maps.LatLng(sw.lat, sw.lng),
    new naver.maps.LatLng(ne.lat, ne.lng)
  );
  map.fitBounds(b, { top:padding, right:padding, bottom:padding, left:padding });
}

function fitMarkers(padding=20){
  if(!markers.length) return;
  const b = new naver.maps.LatLngBounds();
  markers.forEach(m=>b.extend(m.getPosition()));
  map.fitBounds(b, { top:padding, right:padding, bottom:padding, left:padding });
}

function clearMarkers(){
  while(markers.length){ const m = markers.pop(); m.setMap(null); }
  markerById.clear();
  iconById.clear();
}

// 주소 → 좌표
function geocode(address){
  return new Promise((resolve,reject)=>{
    if(!address) return reject(new Error('empty address'));
    const key = normAddr(address);
    if(geocodeCache.has(key)) return resolve(geocodeCache.get(key));
    naver.maps.Service.geocode({ query: address }, (status,res)=>{
      if(status!==naver.maps.Service.Status.OK) return reject(new Error('geocode failed: '+status));
      const item = res.v2?.addresses?.[0];
      if(!item) return reject(new Error('no result'));
      const coord = { lat:Number(item.y), lng:Number(item.x) };
      geocodeCache.set(key, coord);
      resolve(coord);
    });
  });
}

// 주소로 마커 추가
async function addMarkerByAddress({ id, address, title, center=true, zoom=16, icon }){
  try{
    await waitGeocoderReady();
    const { lat, lng } = await geocode(address);    
    const key = id || `addr:${String(address).trim().replace(/\s+/g,' ')}`; 
    if (icon && icon.url) iconById.set(key, icon);
    return upsertMarker({
      id: key, lat, lng, title: title||address, icon: iconById.get(key), center, zoom
    });
  }catch(err){
    post({ type:'ADD_MARKER_BY_ADDRESS_ERR', payload:{ id, address, message:String(err.message||err) } });
  }
}
function addMarker({ id, lat, lng, title, icon, center = false, zoom }) {
  const pos = new naver.maps.LatLng(lat, lng);
  const markerOpts = { position: pos, map, title };

  if (icon && icon.url) {
    markerOpts.icon = {
      url: icon.url,
      size: new naver.maps.Size(icon.w || 28, icon.h || 40),
      anchor: new naver.maps.Point(icon.ax || 14, icon.ay || 40)
    };
  }

  const marker = new naver.maps.Marker(markerOpts);
  markers.push(marker);


  naver.maps.Event.addListener(marker, 'click', () => {
    focusMapTo({ lat, lng });             
    post({ type: 'MARKER_CLICK', payload: { id, lat, lng, title } }); 
  });

  if (center) focusMapTo({ lat, lng, zoom });

  return marker;
}
async function init(){
  // 1) 주소 지오코딩 먼저
  let initCenter = { lat: 37.6424621841481, lng: 127.022094520762 }; // 실패 시 폴백
  try {
    await waitGeocoderReady();
    const p = await geocode('서울 강북구 노해로17길 21'); // 원하는 시작 주소
    initCenter = p;
  } catch (_) {}

  // 2) 지도를 '주소 좌표'로 생성
  map = new naver.maps.Map('map', {
    center: new naver.maps.LatLng(initCenter.lat, initCenter.lng),
    zoom: 15,
    zoomControl: true,
    mapTypeControl: true
  });

  // 3) 부모에 준비됨 통지
  post({ type:'MAP_READY' });

  // 4) 메시지 핸들러
  window.addEventListener('message', (event)=>{
    if (ORIGIN !== '*' && event.origin !== ORIGIN) return;
    const { type, payload } = event.data || {};
    switch(type){
      case 'RESET_MARKERS': clearMarkers(); break;
      case 'FIT_TO_MARKERS': setTimeout(()=>fitMarkers(payload?.padding),120); break;
      case 'SET_CENTER': setCenter(payload); break;
      case 'PAN_TO': panTo(payload); break;
      case 'ADD_MARKER': addMarker(payload); break;
      case 'ADD_MARKER_BY_ADDRESS': addMarkerByAddress(payload); break;
      case 'FIT_BOUNDS': fitBounds(payload); break;
      case 'FIT_MARKERS': fitMarkers(payload?.padding); break;
      case 'CLEAR_MARKERS': clearMarkers(); break;
    }
  });
}

if (window.naver?.maps) init();
else {
  window.navermap_authFailure = function(){ console.error('네이버 지도 인증 실패'); };
  window.addEventListener('load', init);
}