import { getSupabase } from './supabase.js';

const $ = (selector) => document.querySelector(selector);
const money = (value) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(value || 0));
const dateTime = (value) => value ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(new Date(value)) : '—';
const dateOnly = (value) => value ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeZone: 'Europe/Berlin' }).format(new Date(value)) : '—';
const statusLabels = { pending: 'Ожидает', confirmed: 'Подтверждена', completed: 'Завершена', cancelled: 'Отменена', no_show: 'Неявка' };
const slugify = (text) => text.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-|-$/g, '').slice(0, 100);
let db;
let appointments = [];
let services = [];
let specialists = [];
let categories = [];
let scheduleRows = [];
const dayNames = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];

function message(text, type = '') { const el = $('#admin-message'); if (el) { el.textContent = text; el.dataset.type = type; } }
function formMessage(form, text, type = '') { const el = form.querySelector('.form-message'); if (el) { el.textContent = text; el.dataset.type = type; } }
function cell(row, text) { const td = document.createElement('td'); td.textContent = text ?? '—'; row.append(td); return td; }
function makeButton(label, className, handler) { const b = document.createElement('button'); b.type = 'button'; b.className = className; b.textContent = label; b.addEventListener('click', handler); return b; }
function emptyRow(tbody, cols, text) { const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = cols; td.textContent = text; tr.append(td); tbody.replaceChildren(tr); }

async function requireAdmin() {
  const { data: { session }, error: sessionError } = await db.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session) return false;
  const { data, error } = await db.rpc('is_admin');
  if (error) throw new Error('Не удалось проверить роль администратора. Примените SQL-миграции.');
  if (!data) throw new Error('У этой учётной записи нет роли администратора.');
  return true;
}

async function loadCategories() {
  const result = await db.from('categories').select('id,name').order('name');
  if (result.error) throw result.error;
  categories = result.data || [];
  const select = $('#service-category');
  select.replaceChildren(new Option('Без категории', ''));
  categories.forEach((c) => select.add(new Option(c.name, c.id)));
}

async function loadAppointments() {
  const { data, error } = await db.from('appointments')
    .select('id,user_id,client_name,client_phone,client_email,start_at,end_at,status,created_at,service:services(name,price),specialist:specialists(full_name)')
    .order('start_at', { ascending: false }).limit(500);
  if (error) throw error;
  appointments = data || [];
  renderAppointments();
  renderClients();
  renderStats();
}

function renderAppointments() {
  const tbody = $('#appointments-table');
  const filter = $('#appointment-filter').value;
  const rows = appointments.filter(a => filter === 'all' || a.status === filter);
  if (!rows.length) return emptyRow(tbody, 5, 'Записей по выбранному фильтру пока нет.');
  tbody.replaceChildren();
  rows.forEach((a) => {
    const tr = document.createElement('tr');
    const client = document.createElement('div'); client.className = 'table-primary'; client.textContent = a.client_name;
    const contact = document.createElement('small'); contact.textContent = [a.client_phone, a.client_email].filter(Boolean).join(' · '); contact.className = 'table-secondary';
    const c1 = document.createElement('td'); c1.append(client, contact); tr.append(c1);
    const c2 = document.createElement('td'); const service = document.createElement('div'); service.className = 'table-primary'; service.textContent = a.service?.name || 'Услуга удалена'; const specialist = document.createElement('small'); specialist.className = 'table-secondary'; specialist.textContent = a.specialist?.full_name || 'Специалист не указан'; c2.append(service, specialist); tr.append(c2);
    cell(tr, dateTime(a.start_at));
    const statusCell = document.createElement('td'); const select = document.createElement('select'); select.setAttribute('aria-label', `Статус записи ${a.client_name}`);
    Object.entries(statusLabels).forEach(([value, label]) => select.add(new Option(label, value)));
    select.value = a.status; statusCell.append(select); tr.append(statusCell);
    const actionCell = document.createElement('td'); const save = makeButton('Сохранить', 'button button-small', async () => {
      save.disabled = true;
      try { const { error } = await db.from('appointments').update({ status: select.value }).eq('id', a.id); if (error) throw error; a.status = select.value; message('Статус записи обновлён.', 'success'); renderStats(); }
      catch (e) { message(`Не удалось обновить запись: ${e.message}`, 'error'); select.value = a.status; }
      finally { save.disabled = false; }
    }); actionCell.append(save); tr.append(actionCell); tbody.append(tr);
  });
}

function renderServices() {
  const root = $('#services-admin-list'); root.replaceChildren();
  if (!services.length) { root.textContent = 'Услуг пока нет. Добавьте первую услугу выше.'; root.className = 'admin-record-list empty-state'; return; }
  root.className = 'admin-record-list';
  services.forEach(s => {
    const item = document.createElement('article'); item.className = 'admin-record';
    const info = document.createElement('div'); const title = document.createElement('h3'); title.textContent = s.name; const detail = document.createElement('p'); detail.textContent = `${money(s.price)} · ${s.duration_minutes} мин. · ${s.is_active ? 'Опубликована' : 'Скрыта'}`; info.append(title, detail);
    const actions = document.createElement('div'); actions.className = 'admin-record-actions';
    actions.append(makeButton('Изменить', 'button button-small button-outline', () => {
      const f = $('#service-editor'); f.elements.id.value = s.id; f.elements.name.value = s.name; f.elements.category_id.value = s.category_id || ''; f.elements.price.value = s.price; f.elements.duration_minutes.value = s.duration_minutes; f.elements.short_description.value = s.short_description || ''; f.elements.image_url.value = s.image_url || ''; f.elements.is_active.checked = s.is_active; f.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
    actions.append(makeButton(s.is_active ? 'Скрыть' : 'Опубликовать', 'button button-small', async () => {
      const { error } = await db.from('services').update({ is_active: !s.is_active }).eq('id', s.id);
      if (error) message(`Не удалось изменить публикацию: ${error.message}`, 'error'); else { s.is_active = !s.is_active; renderServices(); message('Статус услуги изменён.', 'success'); }
    }));
    item.append(info, actions); root.append(item);
  });
}

function renderSpecialists() {
  const serviceSelect = $('#specialist-service-ids');
  const selectedServiceIds = new Set([...serviceSelect.selectedOptions].map(o=>o.value));
  serviceSelect.replaceChildren(...services.map(s=>new Option(s.name,s.id)));
  [...serviceSelect.options].forEach(o=>o.selected=selectedServiceIds.has(o.value));
  const scheduleSpecialist = $('#schedule-specialist');
  const selectedSpecialistId = scheduleSpecialist.value;
  scheduleSpecialist.replaceChildren(...specialists.map(s=>new Option(s.full_name,s.id)));
  if(selectedSpecialistId && specialists.some(s=>s.id===selectedSpecialistId)) scheduleSpecialist.value=selectedSpecialistId;
  const root = $('#specialists-admin-list'); root.replaceChildren();
  if (!specialists.length) { root.textContent = 'Специалистов пока нет.'; root.className = 'admin-record-list empty-state'; return; }
  root.className = 'admin-record-list';
  specialists.forEach(s => {
    const item = document.createElement('article'); item.className = 'admin-record';
    const info = document.createElement('div'); const title = document.createElement('h3'); title.textContent = s.full_name; const detail = document.createElement('p'); detail.textContent = `${s.position || 'Специалист'} · ${s.experience_years ?? 0} лет опыта · ${s.is_active ? 'Активен' : 'Скрыт'}`; info.append(title, detail);
    const actions = document.createElement('div'); actions.className = 'admin-record-actions';
    actions.append(makeButton('Изменить', 'button button-small button-outline', () => { const f = $('#specialist-editor'); f.elements.id.value=s.id; f.elements.full_name.value=s.full_name; f.elements.position.value=s.position||''; f.elements.experience_years.value=s.experience_years??''; f.elements.photo_url.value=s.photo_url||''; f.elements.bio.value=s.bio||''; f.elements.is_active.checked=s.is_active; db.from('specialist_services').select('service_id').eq('specialist_id',s.id).then(({data,error})=>{if(error){message('Не удалось загрузить услуги специалиста.','error');return;}const ids=new Set((data||[]).map(x=>x.service_id));[...f.elements.service_ids.options].forEach(o=>o.selected=ids.has(o.value));}); f.scrollIntoView({behavior:'smooth',block:'center'}); }));
    actions.append(makeButton(s.is_active ? 'Скрыть' : 'Активировать', 'button button-small', async () => { const {error}=await db.from('specialists').update({is_active:!s.is_active}).eq('id',s.id); if(error) message(`Не удалось изменить статус: ${error.message}`,'error'); else {s.is_active=!s.is_active;renderSpecialists();message('Профиль обновлён.','success');} }));
    item.append(info,actions); root.append(item);
  });
}

function renderSchedule() {
  const root=$('#schedule-list'); root.replaceChildren();
  const selected=$('#schedule-specialist').value;
  const rows=scheduleRows.filter(r=>!selected||r.specialist_id===selected).sort((a,b)=>a.day_of_week-b.day_of_week);
  if(!rows.length){root.className='admin-record-list empty-state';root.textContent='Рабочие часы не настроены.';return;}
  root.className='admin-record-list';
  rows.forEach(r=>{const item=document.createElement('article');item.className='admin-record';const info=document.createElement('div');const title=document.createElement('h3');title.textContent=`${r.specialist?.full_name||'Специалист'} · ${dayNames[r.day_of_week]||'День'}`;const detail=document.createElement('p');detail.textContent=r.is_day_off?'Выходной':`${String(r.start_time).slice(0,5)}–${String(r.end_time).slice(0,5)}`;info.append(title,detail);const actions=document.createElement('div');actions.className='admin-record-actions';actions.append(makeButton('Удалить', 'button button-small button-outline',async()=>{const {error}=await db.from('working_hours').delete().eq('id',r.id);if(error)message(`Не удалось удалить часы: ${error.message}`,'error');else{scheduleRows=scheduleRows.filter(x=>x.id!==r.id);renderSchedule();message('Рабочие часы удалены.','success');}}));item.append(info,actions);root.append(item);});
}

function renderClients() {
  const tbody = $('#clients-table');
  const search = ($('#client-search')?.value || '').toLocaleLowerCase('ru');
  const map = new Map();
  appointments.forEach(a => {
    const key = `${(a.client_phone || '').replace(/\D/g, '')}|${(a.client_email || '').toLowerCase()}` || a.id;
    const old = map.get(key) || { name:a.client_name, phone:a.client_phone, email:a.client_email, count:0, latest:a.start_at };
    old.count += 1; if (new Date(a.start_at) > new Date(old.latest)) { old.latest=a.start_at; old.name=a.client_name; old.phone=a.client_phone; old.email=a.client_email; }
    map.set(key, old);
  });
  const clients = [...map.values()].filter(c => `${c.name} ${c.phone||''} ${c.email||''}`.toLocaleLowerCase('ru').includes(search)).sort((a,b)=>a.name.localeCompare(b.name,'ru'));
  if (!clients.length) return emptyRow(tbody,5,'Клиенты не найдены.');
  tbody.replaceChildren(); clients.forEach(c => { const tr=document.createElement('tr'); cell(tr,c.name); cell(tr,c.phone); cell(tr,c.email); cell(tr,String(c.count)); cell(tr,dateOnly(c.latest)); tbody.append(tr); });
}

function renderStats() {
  const root = $('#admin-stats'); root.replaceChildren();
  const cards = [
    ['Всего записей', appointments.length],
    ['Ожидают подтверждения', appointments.filter(a=>a.status==='pending').length],
    ['Подтверждены', appointments.filter(a=>a.status==='confirmed').length],
    ['Опубликовано услуг', services.filter(s=>s.is_active).length]
  ];
  cards.forEach(([label,value])=>{const card=document.createElement('article');card.className='admin-stat';const strong=document.createElement('strong');strong.textContent=String(value);const caption=document.createElement('span');caption.textContent=label;card.append(strong,caption);root.append(card);});
}

async function loadAll() {
  message('Загружаем данные…');
  const [serviceResult, specialistResult] = await Promise.all([
    db.from('services').select('id,category_id,name,slug,short_description,price,duration_minutes,image_url,is_active').order('name'),
    db.from('specialists').select('id,full_name,position,bio,photo_url,experience_years,is_active').order('full_name')
  ]);
  if (serviceResult.error) throw serviceResult.error;
  if (specialistResult.error) throw specialistResult.error;
  services=serviceResult.data||[]; specialists=specialistResult.data||[];
  const scheduleResult=await db.from('working_hours').select('id,specialist_id,day_of_week,start_time,end_time,is_day_off,specialist:specialists(full_name)').order('day_of_week');
  if(scheduleResult.error) throw scheduleResult.error; scheduleRows=scheduleResult.data||[];
  await loadCategories(); await loadAppointments(); renderServices(); renderSpecialists(); renderSchedule(); renderStats(); message('Данные обновлены.','success');
}

function bindEditors() {
  const serviceForm = $('#service-editor');
  serviceForm.addEventListener('submit', async e => {
    e.preventDefault(); if (!serviceForm.reportValidity()) return;
    const f=serviceForm.elements; const name=f.name.value.trim();
    const payload={name,slug:slugify(name),category_id:f.category_id.value||null,price:Number(f.price.value),duration_minutes:Number(f.duration_minutes.value),short_description:f.short_description.value.trim()||null,image_url:f.image_url.value.trim()||null,is_active:f.is_active.checked};
    const id=f.id.value; const result=id?await db.from('services').update(payload).eq('id',id):await db.from('services').insert(payload);
    if(result.error){formMessage(serviceForm,`Не удалось сохранить услугу: ${result.error.message}`,'error');return;}
    serviceForm.reset(); f.id.value=''; f.duration_minutes.value=60; f.is_active.checked=true; formMessage(serviceForm,'Услуга сохранена.','success'); await loadAll();
  });
  $('#service-cancel-edit').addEventListener('click',()=>{serviceForm.reset();serviceForm.elements.id.value='';serviceForm.elements.duration_minutes.value=60;serviceForm.elements.is_active.checked=true;formMessage(serviceForm,'');});
  const specialistForm=$('#specialist-editor');
  specialistForm.addEventListener('submit',async e=>{e.preventDefault();if(!specialistForm.reportValidity())return;const f=specialistForm.elements;const payload={full_name:f.full_name.value.trim(),position:f.position.value.trim()||null,experience_years:f.experience_years.value===''?null:Number(f.experience_years.value),photo_url:f.photo_url.value.trim()||null,bio:f.bio.value.trim()||null,is_active:f.is_active.checked};const id=f.id.value;let savedId=id;const result=id?await db.from('specialists').update(payload).eq('id',id):await db.from('specialists').insert(payload).select('id').single();if(result.error){formMessage(specialistForm,`Не удалось сохранить специалиста: ${result.error.message}`,'error');return;}if(!id)savedId=result.data.id;const selectedIds=[...f.service_ids.selectedOptions].map(o=>o.value);const del=await db.from('specialist_services').delete().eq('specialist_id',savedId);if(del.error){formMessage(specialistForm,`Профиль сохранён, но не удалось обновить услуги: ${del.error.message}`,'error');return;}if(selectedIds.length){const ins=await db.from('specialist_services').insert(selectedIds.map(service_id=>({specialist_id:savedId,service_id})));if(ins.error){formMessage(specialistForm,`Профиль сохранён, но не удалось назначить услуги: ${ins.error.message}`,'error');return;}}specialistForm.reset();f.id.value='';f.is_active.checked=true;formMessage(specialistForm,'Профиль и услуги сохранены.','success');await loadAll();});
  $('#specialist-cancel-edit').addEventListener('click',()=>{specialistForm.reset();specialistForm.elements.id.value='';specialistForm.elements.is_active.checked=true;formMessage(specialistForm,'');});
  const scheduleForm=$('#schedule-editor');
  scheduleForm.addEventListener('submit',async e=>{e.preventDefault();if(!scheduleForm.reportValidity())return;const f=scheduleForm.elements;const specialistId=f.specialist_id.value;if(!specialistId){formMessage(scheduleForm,'Сначала добавьте специалиста.','error');return;}const day=Number(f.day_of_week.value);const off=f.is_day_off.checked;if(!off&&(!f.start_time.value||!f.end_time.value||f.end_time.value<=f.start_time.value)){formMessage(scheduleForm,'Время окончания должно быть позже времени начала.','error');return;}const del=await db.from('working_hours').delete().eq('specialist_id',specialistId).eq('day_of_week',day);if(del.error){formMessage(scheduleForm,`Не удалось обновить расписание: ${del.error.message}`,'error');return;}const ins=await db.from('working_hours').insert({specialist_id:specialistId,day_of_week:day,start_time:off?null:f.start_time.value,end_time:off?null:f.end_time.value,is_day_off:off});if(ins.error){formMessage(scheduleForm,`Не удалось сохранить расписание: ${ins.error.message}`,'error');return;}formMessage(scheduleForm,off?'Выходной день сохранён.':'Рабочие часы сохранены.','success');await loadAll();});
  $('#schedule-specialist').addEventListener('change',renderSchedule);
  $('#appointment-filter').addEventListener('change',renderAppointments);
  $('#client-search').addEventListener('input',renderClients);
  $('#admin-refresh').addEventListener('click',()=>loadAll().catch(e=>message(`Ошибка обновления: ${e.message}`,'error')));
  document.querySelectorAll('.admin-tab').forEach(tab=>tab.addEventListener('click',()=>{document.querySelectorAll('.admin-tab').forEach(t=>{const active=t===tab;t.classList.toggle('is-active',active);t.setAttribute('aria-selected',String(active));});document.querySelectorAll('.admin-panel').forEach(p=>p.hidden=p.id!==`panel-${tab.dataset.panel}`);}));
}

async function boot() {
  const locked=$('#admin-locked'), app=$('#admin-app'), login=$('#admin-login');
  try { db=await getSupabase(); if(!db){login.querySelector('.form-message').textContent='Сначала укажите SUPABASE_URL и SUPABASE_ANON_KEY в js/config.js.';login.querySelector('button').disabled=true;return;}
    const allowed=await requireAdmin();
    if(!allowed){locked.hidden=false;}
    else {locked.hidden=true;app.hidden=false;bindEditors();await loadAll();}
  } catch(e) { locked.hidden=false; login.querySelector('.form-message').textContent=e.message||'Не удалось проверить доступ.'; }
  login.addEventListener('submit',async e=>{e.preventDefault();const f=login.elements;const button=login.querySelector('button');button.disabled=true;try{const {error}=await db.auth.signInWithPassword({email:f.email.value.trim(),password:f.password.value});if(error)throw error;const allowed=await requireAdmin();if(!allowed)throw new Error('Аккаунт не имеет роли администратора.');locked.hidden=true;app.hidden=false;bindEditors();await loadAll();}catch(err){login.querySelector('.form-message').textContent=err.message||'Ошибка входа.';}finally{button.disabled=false;}});
  $('#admin-signout').addEventListener('click',async()=>{if(db)await db.auth.signOut();location.href='auth.html';});
}
boot();
