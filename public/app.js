const app = document.querySelector('#app');
const nav = document.querySelector('#nav');
const modalRoot = document.querySelector('#modal-root');
const toastRoot = document.querySelector('#toast-root');

const state = { admin: false, bases: [], ingredients: [], filters: { sweet: null, acid: null, strength: null, base: '' } };

const SUPABASE_URL = 'https://oordtnwneordvusqvcds.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UVriJo56omoyLryAnfMYHw_ASk5fRHg';
const ADMIN_EMAIL = 'homebar-admin@example.com';
const SESSION_KEY = 'home-bar-session';

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));

const storedSession = () => {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
};
async function activeSession() {
  let session = storedSession();
  if (!session?.access_token) return null;
  if ((session.expires_at || 0) * 1000 > Date.now() + 30_000) return session;
  if (!session.refresh_token) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: session.refresh_token })
  });
  if (!response.ok) { localStorage.removeItem(SESSION_KEY); return null; }
  session = await response.json();
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}
async function sbFetch(path, options = {}, admin = false) {
  const session = admin ? await activeSession() : null;
  if (admin && !session) throw new Error('Требуется вход администратора');
  const headers = { apikey: SUPABASE_KEY, ...options.headers };
  if (session) headers.Authorization = `Bearer ${session.access_token}`;
  const response = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.msg || data.error_description || data.error || 'Что-то пошло не так');
  return data;
}
const normalizeCocktail = row => ({
  ...row, base: row.base?.name || row.base || '',
  ingredients: (row.cocktail_ingredients || row.ingredients || []).map(x => x.ingredient || x)
});
const cocktailSelect = 'id,name,photo,sweetness,acidity,strength,base_id,base:bases(id,name),cocktail_ingredients(ingredient:ingredients(id,name,in_stock))';
async function fetchCocktails(includeUnavailable = false) {
  const rows = await sbFetch(`/rest/v1/cocktails?select=${encodeURIComponent(cocktailSelect)}&order=name.asc`);
  const normalized = rows.map(normalizeCocktail);
  return includeUnavailable ? normalized : normalized.filter(c => c.ingredients.every(i => i.in_stock));
}
async function uploadPhoto(file) {
  if (!file?.size) return null;
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Разрешены только JPG, PNG и WEBP');
  if (file.size > 5 * 1024 * 1024) throw new Error('Фото должно быть не больше 5 МБ');
  const ext = { 'image/jpeg':'jpg','image/png':'png','image/webp':'webp' }[file.type];
  const filename = `${Date.now()}_${crypto.randomUUID()}.${ext}`;
  await sbFetch(`/storage/v1/object/cocktail-photos/${filename}`, { method:'POST', headers:{'Content-Type':file.type,'x-upsert':'false'}, body:file }, true);
  return `${SUPABASE_URL}/storage/v1/object/public/cocktail-photos/${filename}`;
}
async function saveRemoteCocktail(data, file, id = null) {
  const photo = await uploadPhoto(file);
  const payload = { name:data.name.trim(), base_id:data.base_id, sweetness:data.sweetness, acidity:data.acidity, strength:data.strength };
  if (photo) payload.photo = photo;
  const path = id ? `/rest/v1/cocktails?id=eq.${id}` : '/rest/v1/cocktails';
  const rows = await sbFetch(path, { method:id?'PATCH':'POST', headers:{'Content-Type':'application/json','Prefer':'return=representation'}, body:JSON.stringify(payload) }, true);
  const cocktailId = id || rows[0]?.id;
  if (!cocktailId) throw new Error('Не удалось сохранить коктейль');
  if (id) await sbFetch(`/rest/v1/cocktail_ingredients?cocktail_id=eq.${id}`, { method:'DELETE', headers:{Prefer:'return=minimal'} }, true);
  await sbFetch('/rest/v1/cocktail_ingredients', { method:'POST', headers:{'Content-Type':'application/json','Prefer':'return=minimal'}, body:JSON.stringify(data.ingredients.map(ingredient_id => ({cocktail_id:cocktailId,ingredient_id}))) }, true);
  return cocktailId;
}
async function request(url, options = {}) {
  const method = options.method || 'GET';
  const parsed = new URL(url, location.origin);
  const jsonInput = () => JSON.parse(options.body || '{}');
  if (parsed.pathname === '/api/session') return { admin: Boolean(await activeSession()) };
  if (parsed.pathname === '/api/login' && method === 'POST') {
    const data = await sbFetch('/auth/v1/token?grant_type=password', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:ADMIN_EMAIL,password:jsonInput().password}) });
    localStorage.setItem(SESSION_KEY, JSON.stringify(data)); return { admin:true };
  }
  if (parsed.pathname === '/api/logout') { const session=await activeSession(); if(session) await sbFetch('/auth/v1/logout',{method:'POST'},true).catch(()=>{}); localStorage.removeItem(SESSION_KEY); return {admin:false}; }
  if (parsed.pathname === '/api/bases' && method === 'GET') return sbFetch('/rest/v1/bases?select=*&order=id.asc');
  if (parsed.pathname === '/api/bases' && method === 'POST') {
    const name = String(jsonInput().name || '').trim();
    if (!name) throw new Error('Введите название основы');
    const rows = await sbFetch('/rest/v1/bases', { method:'POST', headers:{'Content-Type':'application/json','Prefer':'return=representation'}, body:JSON.stringify({name}) }, true);
    return rows[0];
  }
  const baseMatch=parsed.pathname.match(/^\/api\/bases\/(\d+)$/);
  if(baseMatch&&method==='PATCH'){
    const name = String(jsonInput().name || '').trim();
    if (!name) throw new Error('Введите название основы');
    const rows=await sbFetch(`/rest/v1/bases?id=eq.${baseMatch[1]}`,{method:'PATCH',headers:{'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify({name})},true);return rows[0];
  }
  if(baseMatch&&method==='DELETE') return sbFetch(`/rest/v1/bases?id=eq.${baseMatch[1]}`,{method:'DELETE',headers:{Prefer:'return=minimal'}},true);
  if (parsed.pathname === '/api/cocktails' && method === 'GET') {
    let rows = await fetchCocktails(false);
    const map = {sweet:'sweetness',acid:'acidity',strength:'strength'};
    for (const [query,field] of Object.entries(map)) if (parsed.searchParams.has(query)) rows=rows.filter(c=>c[field]===Number(parsed.searchParams.get(query)));
    if(parsed.searchParams.get('base')) rows=rows.filter(c=>c.base_id===Number(parsed.searchParams.get('base')));
    return rows;
  }
  if (parsed.pathname === '/api/ingredients' && method === 'GET') return sbFetch('/rest/v1/ingredients?select=*&order=name.asc',{},true);
  if (parsed.pathname === '/api/ingredients' && method === 'POST') {
    const rows=await sbFetch('/rest/v1/ingredients',{method:'POST',headers:{'Content-Type':'application/json','Prefer':'return=representation'},body:options.body},true);return rows[0];
  }
  if (parsed.pathname === '/api/ingredients/bulk' && method === 'PATCH') return sbFetch('/rest/v1/ingredients?id=gt.0',{method:'PATCH',headers:{'Content-Type':'application/json','Prefer':'return=minimal'},body:options.body},true);
  const ingredientMatch=parsed.pathname.match(/^\/api\/ingredients\/(\d+)$/);
  if(ingredientMatch&&method==='PATCH'){const rows=await sbFetch(`/rest/v1/ingredients?id=eq.${ingredientMatch[1]}`,{method:'PATCH',headers:{'Content-Type':'application/json','Prefer':'return=representation'},body:options.body},true);return rows[0];}
  if(parsed.pathname==='/api/admin/cocktails'&&method==='GET') return fetchCocktails(true);
  const cocktailMatch=parsed.pathname.match(/^\/api\/cocktails\/(\d+)$/);
  if(cocktailMatch&&method==='GET'){const rows=await fetchCocktails(true);const row=rows.find(c=>c.id===Number(cocktailMatch[1]));if(!row)throw new Error('Коктейль не найден');return row;}
  if((parsed.pathname==='/api/cocktails'&&method==='POST')||(cocktailMatch&&method==='PUT')){const data=JSON.parse(options.body.get('data'));return saveRemoteCocktail(data,options.body.get('photo'),cocktailMatch?Number(cocktailMatch[1]):null);}
  if(cocktailMatch&&method==='DELETE') return sbFetch(`/rest/v1/cocktails?id=eq.${cocktailMatch[1]}`,{method:'DELETE',headers:{Prefer:'return=minimal'}},true);
  if(parsed.pathname==='/api/password'&&method==='PUT'){const session=await activeSession();if(!session)throw new Error('Требуется вход администратора');return sbFetch('/auth/v1/user',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:jsonInput().password})},true);}
  throw new Error('Неизвестный запрос');
}
function toast(message, type = '') {
  const node = document.createElement('div'); node.className = `toast ${type}`; node.textContent = message;
  toastRoot.append(node); setTimeout(() => node.remove(), 3600);
}
function setNav() {
  const route = location.hash.slice(1) || '/';
  nav.innerHTML = state.admin ? `
    <a class="nav-link ${route === '/' ? 'active':''}" href="#/">Бар</a>
    <a class="nav-link ${route === '/manage' ? 'active':''}" href="#/manage"><span>Коктейли</span> ◇</a>
    <a class="nav-link ${route === '/bases' ? 'active':''}" href="#/bases"><span>Основы</span> ✦</a>
    <a class="nav-link ${route === '/inventory' ? 'active':''}" href="#/inventory"><span>Стоп-лист</span> ◌</a>
    <a class="nav-link ${route.startsWith('/editor') ? 'active':''}" href="#/editor"><span>Добавить</span> ＋</a>
    <button class="icon-button" id="settings" title="Настройки">⚙</button>
    <button class="icon-button" id="logout" title="Выйти">↗</button>` : `
    <a class="nav-link active" href="#/">Меню</a>
    <button class="icon-button" id="login" title="Вход администратора">⌁</button>`;
  document.querySelector('#login')?.addEventListener('click', loginModal);
  document.querySelector('#settings')?.addEventListener('click', settingsModal);
  document.querySelector('#logout')?.addEventListener('click', async () => { await request('/api/logout', { method:'POST' }); state.admin=false; location.hash='/'; setNav(); toast('Вы вышли из режима администратора'); });
}
function settingsModal() {
  showModal(`<p class="eyebrow">Безопасность</p><h2>Новый пароль</h2><p>Минимум 8 символов. После сохранения используйте новый пароль при следующем входе.</p>
    <form id="password-form"><input class="field" type="password" name="password" minlength="8" placeholder="Новый пароль" required autofocus><input class="field" type="password" name="confirm" minlength="8" placeholder="Повторите пароль" required><p class="error-text"></p><div class="modal-actions"><button class="button secondary" type="button" data-close>Отмена</button><button class="button">Сохранить</button></div></form>`);
  modalRoot.querySelector('[data-close]').onclick=closeModal;
  modalRoot.querySelector('form').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget),error=e.currentTarget.querySelector('.error-text');if(fd.get('password')!==fd.get('confirm')){error.textContent='Пароли не совпадают';return;}try{await request('/api/password',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:fd.get('password')})});closeModal();toast('Пароль обновлён');}catch(err){error.textContent=err.message;}};
}
function showModal(content) { modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal">${content}</div></div>`; }
function closeModal() { modalRoot.innerHTML = ''; }
function loginModal() {
  showModal(`<p class="eyebrow">Только для хозяев</p><h2>Вход в бар</h2><p>Управляйте меню и отмечайте, что закончилось на полке.</p>
    <form id="login-form"><input class="field" type="password" name="password" placeholder="Пароль" autofocus required><p class="error-text"></p><div class="modal-actions"><button class="button secondary" type="button" data-close>Отмена</button><button class="button">Войти</button></div></form>`);
  modalRoot.querySelector('[data-close]').onclick = closeModal;
  modalRoot.querySelector('.modal-backdrop').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
  modalRoot.querySelector('#login-form').onsubmit = async e => {
    e.preventDefault(); const error = e.currentTarget.querySelector('.error-text'); error.textContent='';
    try { await request('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({password:new FormData(e.currentTarget).get('password')}) }); state.admin=true; closeModal(); setNav(); toast('Добро пожаловать за стойку'); }
    catch (err) { error.textContent=err.message; }
  };
}

function rangeControl(key, title, value, low, high) {
  const enabled = state.filters[key] !== null;
  return `<div class="filter-control"><div class="filter-head"><label><input class="use-filter" type="checkbox" data-enable="${key}" ${enabled?'checked':''}>${title}</label><span class="filter-value" data-value="${key}">${enabled ? value : 'любая'}</span></div>
    <input type="range" min="0" max="5" step="1" value="${value}" data-range="${key}" aria-label="${title}" ${enabled?'':'disabled'}><div class="filter-head" style="margin:9px 0 0"><small>${low}</small><small>${high}</small></div></div>`;
}
function cocktailCard(c, index) {
  const colors = {'Джин':'#6aa38d','Водка':'#9faec5','Ром':'#c77e3c','Текила':'#9bbd66','Виски':'#c57b39','Ликер':'#a95868','Безалкогольная':'#63a997'};
  const drops = Array.from({length:5},(_,i)=>`<span class="${i<c.strength?'':'off'}">◆</span>`).join('');
  return `<article class="cocktail-card" style="animation-delay:${Math.min(index*55,330)}ms;--glow:${colors[c.base]||'#b97747'}">
    <div class="card-image">${c.photo?`<img src="${escapeHtml(c.photo)}" alt="${escapeHtml(c.name)}">`:''}<span class="base-pill">${escapeHtml(c.base)}</span></div>
    <div class="card-body"><h3>${escapeHtml(c.name)}</h3><p class="ingredients">${c.ingredients.map(x=>escapeHtml(x.name)).join(' · ')}</p>
      <div class="card-meta"><span>КРЕПОСТЬ</span><span class="drops" aria-label="Крепость ${c.strength} из 5">${drops}</span></div></div></article>`;
}
async function loadCocktails() {
  const grid = document.querySelector('#cocktails'); if (!grid) return;
  grid.innerHTML='<div class="page-loader"><span></span></div>';
  const query = new URLSearchParams();
  for (const key of ['sweet','acid','strength']) if (state.filters[key] !== null) query.set(key,state.filters[key]);
  if (state.filters.base) query.set('base',state.filters.base);
  try {
    const rows = await request(`/api/cocktails?${query}`);
    document.querySelector('#result-count').textContent = `${rows.length} ${plural(rows.length,'вариант','варианта','вариантов')}`;
    grid.innerHTML = rows.length ? rows.map(cocktailCard).join('') : `<div class="empty"><b>Сегодня не сложилось</b>К сожалению, под такие параметры ничего нет.<br>Попробуйте изменить фильтры.</div>`;
  } catch(err) { grid.innerHTML=`<div class="empty"><b>Не удалось открыть меню</b>${escapeHtml(err.message)}</div>`; }
}
function plural(n,one,few,many){n=Math.abs(n)%100;const n1=n%10;return n>10&&n<20?many:n1>1&&n1<5?few:n1===1?one:many;}
async function homePage() {
  if (!state.bases.length) state.bases = await request('/api/bases');
  const values = {sweet:2,acid:3,strength:3};
  app.innerHTML = `<section class="hero"><div class="hero-copy"><p class="eyebrow">Ваш вечер · ваш вкус</p><h1>Что нальём<br>сегодня?</h1><p>Настройте вкус и характер напитка. Мы покажем только то, что можно приготовить прямо сейчас.</p></div><div class="hero-art" aria-hidden="true"><div class="glass"></div></div></section>
  <section aria-label="Фильтры" class="filter-panel">
    ${rangeControl('sweet','Сладость',state.filters.sweet ?? values.sweet,'сухо','сладко')}
    ${rangeControl('acid','Кислота',state.filters.acid ?? values.acid,'мягко','ярко')}
    ${rangeControl('strength','Крепость',state.filters.strength ?? values.strength,'0%','крепко')}
    <div class="filter-control"><div class="filter-head"><label for="base">Основа</label><span class="filter-value">◈</span></div><select id="base"><option value="">Любая основа</option>${state.bases.map(b=>`<option value="${b.id}" ${String(b.id)===String(state.filters.base)?'selected':''}>${escapeHtml(b.name)}</option>`).join('')}</select></div>
  </section>
  <div class="results-head"><div><p class="eyebrow">Подходит под настроение</p><h2>Коктейли</h2></div><span class="count" id="result-count"></span></div><section class="cocktail-grid" id="cocktails"></section>`;
  document.querySelectorAll('[data-enable]').forEach(toggle => toggle.addEventListener('change', e => {
    const key=e.target.dataset.enable; const range=document.querySelector(`[data-range="${key}"]`); range.disabled=!e.target.checked;
    state.filters[key]=e.target.checked?Number(range.value):null; document.querySelector(`[data-value="${key}"]`).textContent=e.target.checked?range.value:'любая'; loadCocktails();
  }));
  document.querySelectorAll('[data-range]').forEach(range=>range.addEventListener('input',e=>{const key=e.target.dataset.range;state.filters[key]=Number(e.target.value);document.querySelector(`[data-value="${key}"]`).textContent=e.target.value;loadCocktails();}));
  document.querySelector('#base').onchange=e=>{state.filters.base=e.target.value;loadCocktails();};
  await loadCocktails();
}

async function inventoryPage() {
  const ingredients = await request('/api/ingredients'); state.ingredients=ingredients;
  app.innerHTML=`<section class="admin-hero"><div><p class="eyebrow">Инвентарь</p><h1>Что есть на полке</h1></div><div class="admin-actions"><button class="button secondary" data-bulk="0">Скрыть всё</button><button class="button" data-bulk="1">Показать всё</button></div></section>
    <div class="toolbar"><input class="field" id="search" type="search" placeholder="Найти ингредиент…"><span class="count">${ingredients.length} позиций</span></div><section class="inventory" id="inventory"></section>`;
  const render = query => {
    const list=ingredients.filter(i=>i.name.toLowerCase().includes(query.toLowerCase()));
    document.querySelector('#inventory').innerHTML=list.length?list.map(i=>`<div class="inventory-row"><div><strong>${escapeHtml(i.name)}</strong><small>${i.in_stock?'В наличии':'В стоп-листе'}</small></div><label class="switch"><input type="checkbox" data-id="${i.id}" ${i.in_stock?'checked':''}><span></span></label></div>`).join(''):`<div class="empty"><b>Ничего не найдено</b>Попробуйте другой запрос</div>`;
    document.querySelectorAll('.switch input').forEach(x=>x.onchange=async e=>{try{const item=await request(`/api/ingredients/${e.target.dataset.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({in_stock:e.target.checked})});const local=ingredients.find(i=>i.id===item.id);Object.assign(local,item);e.target.closest('.inventory-row').querySelector('small').textContent=item.in_stock?'В наличии':'В стоп-листе';}catch(err){e.target.checked=!e.target.checked;toast(err.message,'error')}});
  }; render('');
  document.querySelector('#search').oninput=e=>render(e.target.value);
  document.querySelectorAll('[data-bulk]').forEach(btn=>btn.onclick=async e=>{const value=e.currentTarget.dataset.bulk==='1';await request('/api/ingredients/bulk',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({in_stock:value})});ingredients.forEach(i=>i.in_stock=value?1:0);render(document.querySelector('#search').value);toast(value?'Все ингредиенты доступны':'Все ингредиенты в стоп-листе');});
}

async function managePage() {
  const rows=await request('/api/admin/cocktails');
  app.innerHTML=`<section class="admin-hero"><div><p class="eyebrow">Коллекция</p><h1>Коктейли</h1></div><div class="admin-actions"><a class="button secondary" href="#/bases">Основы</a><a class="button" href="#/editor">＋ Новый коктейль</a></div></section><section class="admin-list">${rows.map(c=>`<div class="admin-list-row"><div><strong>${escapeHtml(c.name)}</strong><br><small>${escapeHtml(c.base)} · ${c.ingredients.length} ${plural(c.ingredients.length,'ингредиент','ингредиента','ингредиентов')}</small></div><div class="row-actions"><a class="button secondary small" href="#/editor/${c.id}">Изменить</a><button class="button danger small" data-delete="${c.id}" data-name="${escapeHtml(c.name)}">Удалить</button></div></div>`).join('')}</section>`;
  document.querySelectorAll('[data-delete]').forEach(btn=>btn.onclick=e=>confirmDelete(Number(e.currentTarget.dataset.delete),e.currentTarget.dataset.name));
}
function confirmDelete(id,name){showModal(`<p class="eyebrow">Безвозвратное действие</p><h2>Удалить коктейль?</h2><p>«${escapeHtml(name)}» исчезнет из меню. Ингредиенты останутся в инвентаре.</p><div class="modal-actions"><button class="button secondary" data-close>Отмена</button><button class="button danger" data-confirm>Удалить</button></div>`);modalRoot.querySelector('[data-close]').onclick=closeModal;modalRoot.querySelector('[data-confirm]').onclick=async()=>{await request(`/api/cocktails/${id}`,{method:'DELETE'});closeModal();toast('Коктейль удалён');managePage();};}

async function basesPage() {
  const [bases, cocktails] = await Promise.all([request('/api/bases'), request('/api/admin/cocktails')]);
  state.bases=bases;
  const usage = new Map();
  cocktails.forEach(c=>usage.set(c.base_id,(usage.get(c.base_id)||0)+1));
  app.innerHTML=`<section class="admin-hero"><div><p class="eyebrow">Справочник</p><h1>Основы</h1></div><div class="admin-actions"><button class="button" id="new-base">＋ Новая основа</button></div></section>
    <section class="admin-list">${bases.map(b=>{const count=usage.get(b.id)||0;return `<div class="admin-list-row"><div><strong>${escapeHtml(b.name)}</strong><br><small>${count ? `${count} ${plural(count,'коктейль','коктейля','коктейлей')}` : 'Пока не используется'}</small></div><div class="row-actions"><button class="button secondary small" data-edit-base="${b.id}">Изменить</button><button class="button danger small" data-delete-base="${b.id}" ${count?'disabled title="Сначала переназначьте коктейли на другую основу"':''}>Удалить</button></div></div>`}).join('') || '<div class="empty"><b>Основ пока нет</b>Добавьте первую основу для коктейлей.</div>'}</section>`;
  document.querySelector('#new-base').onclick=()=>baseModal(null, basesPage);
  document.querySelectorAll('[data-edit-base]').forEach(btn=>btn.onclick=e=>baseModal(bases.find(b=>b.id===Number(e.currentTarget.dataset.editBase)), basesPage));
  document.querySelectorAll('[data-delete-base]').forEach(btn=>btn.onclick=e=>confirmBaseDelete(bases.find(b=>b.id===Number(e.currentTarget.dataset.deleteBase)), usage.get(Number(e.currentTarget.dataset.deleteBase))||0));
}
function baseModal(base=null,onSaved=()=>{}) {
  showModal(`<p class="eyebrow">${base?'Редактирование':'Новая основа'}</p><h2>${base?'Изменить основу':'Добавить основу'}</h2><p>Название появится в фильтре на главной и в форме коктейля.</p><form id="base-form"><input class="field" name="name" value="${escapeHtml(base?.name||'')}" placeholder="Например, Мескаль" required autofocus><p class="error-text"></p><div class="modal-actions"><button class="button secondary" type="button" data-close>Отмена</button><button class="button">${base?'Сохранить':'Добавить'}</button></div></form>`);
  modalRoot.querySelector('[data-close]').onclick=closeModal;
  modalRoot.querySelector('form').onsubmit=async e=>{e.preventDefault();const error=e.currentTarget.querySelector('.error-text');error.textContent='';try{const payload={name:new FormData(e.currentTarget).get('name')};const item=await request(base?`/api/bases/${base.id}`:'/api/bases',{method:base?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});state.bases=[];closeModal();await onSaved(item);toast(base?'Основа обновлена':'Основа добавлена');}catch(err){error.textContent=err.message;}};
}
function confirmBaseDelete(base,usageCount=0) {
  if (!base) return;
  if (usageCount) { toast('Сначала переназначьте коктейли на другую основу','error'); return; }
  showModal(`<p class="eyebrow">Безвозвратное действие</p><h2>Удалить основу?</h2><p>«${escapeHtml(base.name)}» исчезнет из списка основ.</p><div class="modal-actions"><button class="button secondary" data-close>Отмена</button><button class="button danger" data-confirm>Удалить</button></div>`);
  modalRoot.querySelector('[data-close]').onclick=closeModal;
  modalRoot.querySelector('[data-confirm]').onclick=async()=>{try{await request(`/api/bases/${base.id}`,{method:'DELETE'});state.bases=[];closeModal();toast('Основа удалена');basesPage();}catch(err){toast(err.message,'error');}};
}

async function editorPage(id) {
  const [bases, ingredients, cocktail] = await Promise.all([request('/api/bases'),request('/api/ingredients'),id?request(`/api/cocktails/${id}`):Promise.resolve(null)]);
  state.bases=bases;state.ingredients=ingredients; const selected=(cocktail?.ingredients||[]).map(x=>x.id);
  app.innerHTML=`<section class="admin-hero"><div><p class="eyebrow">${id?'Редактирование':'Новый рецепт'}</p><h1>${id?escapeHtml(cocktail.name):'Добавить коктейль'}</h1></div><div class="admin-actions"><a class="button secondary" href="#/manage">К списку</a></div></section>
  <div class="editor-layout"><form class="form-card" id="cocktail-form"><div class="form-grid">
    <div class="form-group full"><label>Название *</label><input class="field" name="name" value="${escapeHtml(cocktail?.name||'')}" placeholder="Например, Южный ветер" required></div>
    <div class="form-group"><label>Основа *</label><select name="base_id" required><option value="">Выберите основу</option>${bases.map(b=>`<option value="${b.id}" ${b.id===cocktail?.base_id?'selected':''}>${escapeHtml(b.name)}</option>`).join('')}</select><button class="button secondary small inline-add" id="new-base" type="button">＋ Добавить основу</button></div>
    <div class="form-group"><label>Фото (JPG, PNG, WEBP · до 5 МБ)</label><label class="upload"><input type="file" name="photo" accept="image/jpeg,image/png,image/webp"><strong>${cocktail?.photo?'Заменить фото':'Выбрать фото'}</strong><span id="file-name">${cocktail?.photo?'Текущее фото сохранено':'или перетащите сюда'}</span></label></div>
    ${['sweetness','acidity','strength'].map((key,i)=>`<div class="form-group"><label>${['Сладость','Кислота','Крепость'][i]}</label><div class="range-field"><input type="range" name="${key}" min="0" max="5" value="${cocktail?.[key]??[2,3,3][i]}"><output>${cocktail?.[key]??[2,3,3][i]}</output></div></div>`).join('')}
    <div class="form-group full"><label>Ингредиенты *</label><input class="field" id="ingredient-search" autocomplete="off" placeholder="Начните вводить название…"><div id="suggestions"></div><div class="chips" id="chips"></div><button class="button secondary small" id="new-ingredient" type="button" style="margin-top:12px">＋ Добавить новый ингредиент</button></div>
    <div class="form-group full"><p class="error-text" id="form-error"></p><button class="button" type="submit">${id?'Сохранить изменения':'Сохранить коктейль'}</button></div>
  </div></form><aside class="side-card"><p class="eyebrow">Подсказка</p><h3>Баланс — это всё</h3><p>Оценки вкуса используются в строгом фильтре. Если напиток универсальный, ориентируйтесь на его доминирующий характер.</p><p>Ингредиент в стоп-листе автоматически скроет все связанные с ним коктейли с гостевой страницы.</p></aside></div>`;
  const form=document.querySelector('#cocktail-form');
  form.querySelectorAll('input[type=range]').forEach(r=>r.oninput=e=>e.target.nextElementSibling.value=e.target.value);
  form.photo.onchange=e=>document.querySelector('#file-name').textContent=e.target.files[0]?.name||'или перетащите сюда';
  document.querySelector('#new-base').onclick=()=>baseModal(null,item=>{bases.push(item);state.bases=bases;const select=form.elements.base_id;select.insertAdjacentHTML('beforeend',`<option value="${item.id}">${escapeHtml(item.name)}</option>`);select.value=item.id;});
  const renderChips=()=>{document.querySelector('#chips').innerHTML=selected.map(itemId=>{const i=ingredients.find(x=>x.id===itemId);return i?`<span class="chip">${escapeHtml(i.name)}<button type="button" data-remove="${i.id}" aria-label="Удалить">×</button></span>`:''}).join('');document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=e=>{selected.splice(selected.indexOf(Number(e.currentTarget.dataset.remove)),1);renderChips();});};renderChips();
  const search=document.querySelector('#ingredient-search'),suggestions=document.querySelector('#suggestions');
  search.oninput=e=>{const q=e.target.value.trim().toLowerCase();const found=q?ingredients.filter(i=>!selected.includes(i.id)&&i.name.toLowerCase().includes(q)).slice(0,7):[];suggestions.className=found.length?'suggestions':'';suggestions.innerHTML=found.map(i=>`<button class="suggestion" type="button" data-add="${i.id}">${escapeHtml(i.name)}</button>`).join('');suggestions.querySelectorAll('[data-add]').forEach(b=>b.onclick=x=>{selected.push(Number(x.currentTarget.dataset.add));search.value='';suggestions.innerHTML='';suggestions.className='';renderChips();});};
  document.querySelector('#new-ingredient').onclick=()=>newIngredientModal(ingredients,selected,renderChips);
  form.onsubmit=async e=>{e.preventDefault();const error=document.querySelector('#form-error');error.textContent='';const submit=form.querySelector('[type=submit]');submit.disabled=true;submit.textContent='Сохраняем…';try{const fd=new FormData(form);const data={name:fd.get('name'),base_id:Number(fd.get('base_id')),sweetness:Number(fd.get('sweetness')),acidity:Number(fd.get('acidity')),strength:Number(fd.get('strength')),ingredients:selected};const payload=new FormData();payload.set('data',JSON.stringify(data));if(fd.get('photo')?.size)payload.set('photo',fd.get('photo'));await request(id?`/api/cocktails/${id}`:'/api/cocktails',{method:id?'PUT':'POST',body:payload});toast(id?'Изменения сохранены':'Коктейль добавлен в меню');location.hash='/manage';}catch(err){error.textContent=err.message;submit.disabled=false;submit.textContent=id?'Сохранить изменения':'Сохранить коктейль';}};
}
function newIngredientModal(ingredients,selected,render){showModal(`<p class="eyebrow">Новая позиция</p><h2>Добавить ингредиент</h2><form id="ingredient-form"><input class="field" name="name" placeholder="Название" required autofocus><p class="error-text"></p><div class="modal-actions"><button class="button secondary" type="button" data-close>Отмена</button><button class="button">Добавить</button></div></form>`);modalRoot.querySelector('[data-close]').onclick=closeModal;modalRoot.querySelector('form').onsubmit=async e=>{e.preventDefault();try{const item=await request('/api/ingredients',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:new FormData(e.currentTarget).get('name')})});ingredients.push(item);selected.push(item.id);closeModal();render();toast('Ингредиент добавлен');}catch(err){e.currentTarget.querySelector('.error-text').textContent=err.message;}};}

async function guard() { if (!state.admin) { location.hash='/'; toast('Сначала войдите как администратор','error'); return false; } return true; }
async function route() {
  setNav(); window.scrollTo(0,0); const path=location.hash.slice(1)||'/'; app.innerHTML='<div class="page-loader"><span></span><p>Смешиваем впечатления…</p></div>';
  try {
    if(path==='/') return homePage();
    if(!await guard()) return;
    if(path==='/inventory') return inventoryPage();
    if(path==='/manage') return managePage();
    if(path==='/bases') return basesPage();
    if(path==='/editor') return editorPage(null);
    const match=path.match(/^\/editor\/(\d+)$/);if(match)return editorPage(Number(match[1]));
    location.hash='/';
  } catch(err) { if(err.message.includes('Требуется вход')){state.admin=false;setNav();location.hash='/';} else app.innerHTML=`<div class="empty"><b>Что-то пошло не так</b>${escapeHtml(err.message)}</div>`; }
}

(async()=>{try{const session=await request('/api/session');state.admin=session.admin;}catch{}window.addEventListener('hashchange',route);route();})();
