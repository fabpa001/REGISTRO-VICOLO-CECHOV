const cfg = window.REGISTRO_CONFIG || {};
const db = supabase.createClient(cfg.url, cfg.key);
const $ = id => document.getElementById(id);

const state = { groups: [], teachers: [], programs: [], closures: [] };
const DAY_NAMES = ["", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];
const MONTH_NAMES = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];

function esc(v="") {
  return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
function isoDate(d) { const z = new Date(d.getTime() - d.getTimezoneOffset()*60000); return z.toISOString().slice(0,10); }
function parseDate(s) { return new Date(s + "T12:00:00"); }
function fmtDate(s) { return parseDate(s).toLocaleDateString("it-IT"); }
function fmtShort(s) { return parseDate(s).toLocaleDateString("it-IT",{day:"2-digit",month:"2-digit"}); }
function weekdayIso(s) { const x = parseDate(s).getDay(); return x === 0 ? 7 : x; }
function todayISO() { return isoDate(new Date()); }
function monthValueNow() { return todayISO().slice(0,7); }
function teacherName(id) { return state.teachers.find(x=>x.id===id)?.name || "—"; }
function groupName(id) { return state.groups.find(x=>x.id===id)?.name || "—"; }
function isClosed(date) { return state.closures.some(c => date >= c.start_date && date <= c.end_date); }
function academicYearForMonth(ym) { const [y,m] = ym.split("-").map(Number); return m >= 9 ? `${y}/${y+1}` : `${y-1}/${y}`; }
function academicRange(label) { const y = Number(label.split("/")[0]); return { start:`${y}-09-01`, end:`${y+1}-08-31` }; }
function opts(items, selected="") { return '<option value="">Scegli…</option>' + items.map(x=>`<option value="${x.id}" ${x.id===selected?"selected":""}>${esc(x.name)}</option>`).join(""); }
function showMessage(msg) { alert(msg); }

async function boot() {
  if (!cfg.url || !cfg.key) { $("authmsg").textContent = "Configurazione non disponibile."; return; }
  const { data:{ session } } = await db.auth.getSession();
  if (session) await showApp();
  else { $("auth").hidden = false; $("app").hidden = true; $("authmsg").textContent = "Accedi da Gestione Sale e poi torna qui."; }
}

$("checkAccess").onclick = boot;
$("logout").onclick = async () => { await db.auth.signOut(); location.reload(); };

async function showApp() {
  $("auth").hidden = true;
  $("app").hidden = false;
  setDefaults(); wireNavigation(); wireActions();
  await refreshCore();
  await renderToday();
}

function setDefaults() {
  $("calMonth").value = monthValueNow();
  $("payMonth").value = monthValueNow();
  $("reportMonth").value = monthValueNow();
  const now = new Date();
  const y = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear()-1;
  $("reportYear").innerHTML = [y-1,y,y+1].map(v=>`<option value="${v}/${v+1}">${v}/${v+1}</option>`).join("");
  $("reportYear").value = `${y}/${y+1}`;
}

function wireNavigation() {
  document.querySelectorAll("nav button").forEach(btn => {
    btn.onclick = async () => {
      document.querySelectorAll(".page").forEach(p=>p.hidden=true);
      document.querySelectorAll("nav button").forEach(b=>b.classList.remove("active"));
      $(btn.dataset.page).hidden = false; btn.classList.add("active");
      if (btn.dataset.page === "today") await renderToday();
      if (btn.dataset.page === "calendar") await renderCalendar();
      if (btn.dataset.page === "payments") await loadPayments();
    };
  });
  document.querySelector('nav button[data-page="today"]')?.classList.add("active");
  document.querySelectorAll("[data-tab]").forEach(btn => {
    btn.onclick = async () => {
      document.querySelectorAll(".panel").forEach(p=>p.hidden=true);
      $(btn.dataset.tab).hidden = false;
      if (btn.dataset.tab === "students") await loadStudents();
    };
  });
}

let wired = false;
function wireActions() {
  if (wired) return; wired = true;
  $("addGroup").onclick = addGroup;
  $("addStudent").onclick = addStudent;
  $("studentGroup").onchange = loadStudents;
  $("addTeacher").onclick = addTeacher;
  $("addProgram").onclick = addProgram;
  $("addClosure").onclick = addClosure;
  $("loadCalendar").onclick = renderCalendar;
  $("payGroup").onchange = loadPayments;
  $("payMonth").onchange = loadPayments;
  $("newRecovery").onclick = () => openRecoveryModal();
  $("monthlyReport").onclick = buildMonthlyReport;
  $("annualReport").onclick = buildAnnualReport;
  $("commitmentReport").onclick = buildCommitmentReport;
  $("copyReport").onclick = copyReport;
  $("closeModal").onclick = closeModal;
  $("modal").onclick = e => { if (e.target === $("modal")) closeModal(); };
}

async function refreshCore() {
  const [g,t,p,c] = await Promise.all([
    db.from("reg_groups").select("*").order("name"),
    db.from("reg_teachers").select("*").order("name"),
    db.from("reg_programming").select("*").order("start_date"),
    db.from("reg_closures").select("*").order("start_date")
  ]);
  state.groups = g.data || []; state.teachers = t.data || []; state.programs = p.data || []; state.closures = c.data || [];
  renderManage(); fillSelects();
}

function fillSelects() {
  const activeGroups = state.groups.filter(x=>x.active), activeTeachers = state.teachers.filter(x=>x.active);
  $("studentGroup").innerHTML = opts(activeGroups, $("studentGroup").value);
  $("pGroup").innerHTML = opts(activeGroups, $("pGroup").value);
  $("pTeacher").innerHTML = opts(activeTeachers, $("pTeacher").value);
  $("payGroup").innerHTML = opts(activeGroups, $("payGroup").value);
  $("reportTeacher").innerHTML = opts(state.teachers, $("reportTeacher").value);
}

function renderManage() {
  $("groupsList").innerHTML = state.groups.length ? state.groups.map(g=>`
    <div class="item"><b>${esc(g.name)}</b> ${g.active ? "" : '<span class="tag">non attivo</span>'}
    <div class="actions"><button class="small secondary" onclick="renameGroup('${g.id}')">Rinomina</button><button class="small ${g.active?'danger':'secondary'}" onclick="toggleGroup('${g.id}',${!g.active})">${g.active?'Disattiva':'Riattiva'}</button></div></div>`).join("") : '<div class="empty">Nessun gruppo.</div>';

  $("teacherCount").textContent = `(${state.teachers.filter(x=>x.active).length})`;
  $("teachersList").innerHTML = state.teachers.length ? state.teachers.map(t=>`
    <div class="item"><b>${esc(t.name)}</b> ${t.active ? "" : '<span class="tag">non attivo</span>'}
    <div class="actions"><button class="small secondary" onclick="renameTeacher('${t.id}')">Rinomina</button><button class="small ${t.active?'danger':'secondary'}" onclick="toggleTeacher('${t.id}',${!t.active})">${t.active?'Disattiva':'Riattiva'}</button></div></div>`).join("") : '<div class="empty">Nessun docente.</div>';

  renderPrograms();
  $("closuresList").innerHTML = state.closures.length ? state.closures.map(c=>`
    <div class="item"><b>${esc(c.name)}</b><br>${fmtDate(c.start_date)} – ${fmtDate(c.end_date)}<div class="actions"><button class="small danger" onclick="deleteClosure('${c.id}')">Elimina</button></div></div>`).join("") : '<div class="empty">Nessuna chiusura.</div>';
}

function renderPrograms() {
  const list = state.programs.slice().sort((a,b)=>a.weekday-b.weekday || a.start_time.localeCompare(b.start_time));
  $("programManageList").innerHTML = list.length ? list.map(p=>`
    <div class="item"><b>${esc(groupName(p.group_id))}</b><br>${DAY_NAMES[p.weekday]} ${p.start_time.slice(0,5)}–${p.end_time.slice(0,5)} · ${esc(teacherName(p.teacher_id))}<br>
    <span class="muted">${fmtDate(p.start_date)} – ${fmtDate(p.end_date)}</span> ${p.active ? "" : '<span class="tag">terminata</span>'}
    ${p.active ? `<div class="actions"><button class="small danger" onclick="finishProgram('${p.id}')">Termina</button></div>` : ""}</div>`).join("") : '<div class="empty">Nessuna programmazione.</div>';
}

async function addGroup() {
  const name = $("groupName").value.trim(); if (!name) return;
  const { error } = await db.from("reg_groups").insert({name,active:true}); if (error) return showMessage(error.message);
  $("groupName").value = ""; await refreshCore();
}
window.renameGroup = async id => { const current=state.groups.find(x=>x.id===id); const name=prompt("Nuovo nome del gruppo",current?.name||""); if(!name?.trim())return; const {error}=await db.from("reg_groups").update({name:name.trim()}).eq("id",id); if(error)return showMessage(error.message); await refreshCore(); };
window.toggleGroup = async (id,active) => { const {error}=await db.from("reg_groups").update({active}).eq("id",id); if(error)return showMessage(error.message); await refreshCore(); };

async function loadStudents() {
  const groupId = $("studentGroup").value;
  if (!groupId) { $("studentsList").innerHTML='<div class="empty">Scegli un gruppo.</div>'; return; }
  const {data,error}=await db.from("reg_students").select("*").eq("group_id",groupId).order("name"); if(error)return showMessage(error.message);
  $("studentsList").innerHTML = data.length ? data.map(s=>`
    <div class="item"><b>${esc(s.name)}</b> ${s.active?"":'<span class="tag">non attivo</span>'}
    <div class="actions"><button class="small secondary" onclick="renameStudent('${s.id}')">Rinomina</button><button class="small ${s.active?'danger':'secondary'}" onclick="toggleStudent('${s.id}',${!s.active})">${s.active?'Disattiva':'Riattiva'}</button></div></div>`).join("") : '<div class="empty">Nessun ragazzo inserito.</div>';
}
async function addStudent() {
  const group_id=$("studentGroup").value,name=$("studentName").value.trim(); if(!group_id)return showMessage("Scegli prima il gruppo."); if(!name)return;
  const {error}=await db.from("reg_students").insert({group_id,name,active:true}); if(error)return showMessage(error.message); $("studentName").value=""; await loadStudents();
}
window.renameStudent = async id => { const q=await db.from("reg_students").select("name").eq("id",id).single(); if(q.error)return showMessage(q.error.message); const name=prompt("Nuovo nome",q.data.name); if(!name?.trim())return; const {error}=await db.from("reg_students").update({name:name.trim()}).eq("id",id); if(error)return showMessage(error.message); await loadStudents(); };
window.toggleStudent = async (id,active) => { const {error}=await db.from("reg_students").update({active}).eq("id",id); if(error)return showMessage(error.message); await loadStudents(); };

async function addTeacher() { const name=$("teacherName").value.trim(); if(!name)return; const {error}=await db.from("reg_teachers").insert({name,active:true}); if(error)return showMessage(error.message); $("teacherName").value=""; await refreshCore(); }
window.renameTeacher = async id => { const current=state.teachers.find(x=>x.id===id); const name=prompt("Nuovo nome del docente",current?.name||""); if(!name?.trim())return; const {error}=await db.from("reg_teachers").update({name:name.trim()}).eq("id",id); if(error)return showMessage(error.message); await refreshCore(); };
window.toggleTeacher = async (id,active) => { const {error}=await db.from("reg_teachers").update({active}).eq("id",id); if(error)return showMessage(error.message); await refreshCore(); };

async function addProgram() {
  const payload={group_id:$("pGroup").value,teacher_id:$("pTeacher").value,weekday:Number($("pDay").value),start_date:$("pFrom").value,end_date:$("pTo").value,start_time:$("pStart").value,end_time:$("pEnd").value,active:true};
  if(Object.values(payload).some(v=>v===""||v===null))return showMessage("Completa tutti i campi."); if(payload.end_date<payload.start_date)return showMessage("Controlla le date.");
  const {error}=await db.from("reg_programming").insert(payload); if(error)return showMessage(error.message); await refreshCore();
}
window.finishProgram = async id => { if(!confirm("Terminare questa programmazione? Lo storico rimarrà disponibile."))return; const p=state.programs.find(x=>x.id===id); const end=p&&p.end_date<todayISO()?p.end_date:todayISO(); const {error}=await db.from("reg_programming").update({active:false,end_date:end}).eq("id",id); if(error)return showMessage(error.message); await refreshCore(); };

async function addClosure() {
  const payload={name:$("cName").value.trim(),start_date:$("cFrom").value,end_date:$("cTo").value}; if(!payload.name||!payload.start_date||!payload.end_date)return showMessage("Completa tutti i campi."); if(payload.end_date<payload.start_date)return showMessage("Controlla le date.");
  const {error}=await db.from("reg_closures").insert(payload); if(error)return showMessage(error.message); $("cName").value=""; await refreshCore();
}
window.deleteClosure = async id => { if(!confirm("Eliminare questa chiusura?"))return; const {error}=await db.from("reg_closures").delete().eq("id",id); if(error)return showMessage(error.message); await refreshCore(); };

function programMatches(p,date) { return date>=p.start_date && date<=p.end_date && weekdayIso(date)===p.weekday; }
function programForGroupDate(groupId,date) { const a=state.programs.filter(p=>p.group_id===groupId&&programMatches(p,date)).sort((x,y)=>y.start_date.localeCompare(x.start_date)); return a[0]||null; }
function regularProgramsOn(date) { if(isClosed(date))return[]; return state.programs.filter(p=>p.active&&programMatches(p,date)); }
async function ensureRegularLesson(groupId,date) {
  let q=await db.from("reg_lessons").select("*").eq("group_id",groupId).eq("lesson_date",date).eq("kind","regular").maybeSingle(); if(q.error)throw q.error; if(q.data)return q.data;
  const ins=await db.from("reg_lessons").insert({group_id:groupId,lesson_date:date,kind:"regular",status:"scheduled"}).select().single(); if(ins.error)throw ins.error; return ins.data;
}
async function lessonRowsOn(date) { const {data,error}=await db.from("reg_lessons").select("*").eq("lesson_date",date); if(error)throw error; return data||[]; }
async function originalMapForRecoveries(recoveries) { const ids=[...new Set(recoveries.map(r=>r.recovers_lesson_id).filter(Boolean))]; if(!ids.length)return new Map(); const {data,error}=await db.from("reg_lessons").select("*").in("id",ids); if(error)throw error; return new Map((data||[]).map(x=>[x.id,x])); }
function expectedTeacherForRecovery(recovery,originalMap) { const original=originalMap.get(recovery.recovers_lesson_id); if(!original)return null; return programForGroupDate(original.group_id,original.lesson_date)?.teacher_id || state.groups.find(g=>g.id===original.group_id)?.teacher_id || null; }

async function renderToday() {
  try {
    const date=todayISO(),rows=await lessonRowsOn(date),regularRows=new Map(rows.filter(x=>x.kind==="regular").map(x=>[`${x.group_id}|${x.lesson_date}`,x])),recoveries=rows.filter(x=>x.kind==="recovery"),originalMap=await originalMapForRecoveries(recoveries),programs=regularProgramsOn(date);
    let html=""; if(isClosed(date))html+='<div class="empty">Oggi è inserita una chiusura.</div>';
    for(const p of programs){ const row=regularRows.get(`${p.group_id}|${date}`),cancelled=row?.status==="cancelled",actual=row?.substitute_teacher_id||p.teacher_id;
      html+=`<div class="lesson ${cancelled?'cancelled':''}"><b>${esc(groupName(p.group_id))}</b><br>${p.start_time.slice(0,5)}–${p.end_time.slice(0,5)}<br>Docente: <b>${esc(teacherName(actual))}</b> ${row?.substitute_teacher_id?'<span class="tag sub">Cambio docente</span>':''} ${cancelled?'<span class="tag cancel">Lezione annullata</span>':''}<div class="actions">${cancelled?`<button class="secondary" onclick="restoreRegular('${p.group_id}','${date}')">Ripristina</button><button onclick="openRecoveryModal('${row.id}')">Crea recupero</button>`:`<button onclick="openRegularAbsences('${p.group_id}','${date}')">Assenze</button><button class="secondary" onclick="openRegularTeacherChange('${p.group_id}','${date}')">Cambio docente</button><button class="danger" onclick="cancelRegular('${p.group_id}','${date}')">Annulla</button>`}</div></div>`;
    }
    for(const r of recoveries){ const original=originalMap.get(r.recovers_lesson_id),expected=expectedTeacherForRecovery(r,originalMap),actual=r.substitute_teacher_id||expected;
      html+=`<div class="lesson recovery"><b>${esc(groupName(r.group_id))}</b> <span class="tag recovery">RECUPERO</span><br>${original?'Recupero della lezione del '+fmtDate(original.lesson_date):'Lezione di recupero'}<br>Docente: <b>${esc(teacherName(actual))}</b> ${r.substitute_teacher_id?'<span class="tag sub">Cambio docente</span>':''}<div class="actions"><button onclick="openExistingAbsences('${r.id}','${r.group_id}')">Assenze</button><button class="secondary" onclick="openExistingTeacherChange('${r.id}')">Cambio docente</button><button class="danger" onclick="deleteRecovery('${r.id}')">Elimina recupero</button></div></div>`;
    }
    if(!html)html='<div class="empty">Nessuna lezione oggi.</div>'; $("todayList").innerHTML=html;
  } catch(e){ console.error(e); $("todayList").innerHTML='<div class="empty">Errore nel caricamento delle lezioni.</div>'; }
}

window.cancelRegular = async (groupId,date) => { if(!confirm("Confermi che questa lezione è annullata?"))return; try{const row=await ensureRegularLesson(groupId,date); const {error}=await db.from("reg_lessons").update({status:"cancelled"}).eq("id",row.id); if(error)throw error; await renderToday();}catch(e){showMessage(e.message);} };
window.restoreRegular = async (groupId,date) => { try{const row=await ensureRegularLesson(groupId,date); const {error}=await db.from("reg_lessons").update({status:"scheduled"}).eq("id",row.id); if(error)throw error; await renderToday();}catch(e){showMessage(e.message);} };
window.openRegularAbsences = async (groupId,date) => { try{const row=await ensureRegularLesson(groupId,date); await openAbsenceModal(row.id,groupId);}catch(e){showMessage(e.message);} };
window.openExistingAbsences = async (lessonId,groupId) => openAbsenceModal(lessonId,groupId);

async function openAbsenceModal(lessonId,groupId) {
  const [s,a]=await Promise.all([db.from("reg_students").select("*").eq("group_id",groupId).eq("active",true).order("name"),db.from("reg_absences").select("*").eq("lesson_id",lessonId)]); if(s.error)return showMessage(s.error.message); if(a.error)return showMessage(a.error.message);
  const absent=new Set((a.data||[]).map(x=>x.student_id)); openModal(`<h3>Assenze — ${esc(groupName(groupId))}</h3><p class="muted">Tutti sono presenti di default. Spunta solo chi è assente.</p>${(s.data||[]).length?(s.data||[]).map(x=>`<label class="checkrow"><input type="checkbox" ${absent.has(x.id)?'checked':''} onchange="toggleAbsence('${lessonId}','${x.id}',this.checked)"><span>${esc(x.name)}</span></label>`).join(""):'<div class="empty">Nessun ragazzo inserito nel gruppo.</div>'}`);
}
window.toggleAbsence = async (lessonId,studentId,on) => { if(on){const {error}=await db.from("reg_absences").upsert({lesson_id:lessonId,student_id:studentId},{onConflict:"lesson_id,student_id"}); if(error)showMessage(error.message);}else{const {error}=await db.from("reg_absences").delete().eq("lesson_id",lessonId).eq("student_id",studentId); if(error)showMessage(error.message);} };

window.openRegularTeacherChange = async (groupId,date) => { try{const row=await ensureRegularLesson(groupId,date),expected=programForGroupDate(groupId,date)?.teacher_id||null; openTeacherModal(row,expected);}catch(e){showMessage(e.message);} };
window.openExistingTeacherChange = async lessonId => { const q=await db.from("reg_lessons").select("*").eq("id",lessonId).single(); if(q.error)return showMessage(q.error.message); let expected=null; if(q.data.kind==="regular")expected=programForGroupDate(q.data.group_id,q.data.lesson_date)?.teacher_id||null; else{const map=await originalMapForRecoveries([q.data]); expected=expectedTeacherForRecovery(q.data,map);} openTeacherModal(q.data,expected); };
function openTeacherModal(row,expected) { const active=state.teachers.filter(x=>x.active && x.id!==expected); openModal(`<h3>Cambio docente</h3><p class="muted">Docente previsto: <b>${esc(teacherName(expected))}</b></p><label>Lezione effettuata da<select id="modalTeacher"><option value="">Docente previsto</option>${active.map(t=>`<option value="${t.id}" ${t.id===row.substitute_teacher_id?'selected':''}>${esc(t.name)}</option>`).join("")}</select></label><button onclick="saveTeacherChange('${row.id}')">Salva</button>`); }
window.saveTeacherChange = async lessonId => { const id=$("modalTeacher").value||null; const {error}=await db.from("reg_lessons").update({substitute_teacher_id:id}).eq("id",lessonId); if(error)return showMessage(error.message); closeModal(); await renderToday(); };

window.openRecoveryModal = async preferredId => {
  const cancelledQ=await db.from("reg_lessons").select("*").eq("kind","regular").eq("status","cancelled").order("lesson_date"),recoveryQ=await db.from("reg_lessons").select("recovers_lesson_id").eq("kind","recovery"); if(cancelledQ.error)return showMessage(cancelledQ.error.message); if(recoveryQ.error)return showMessage(recoveryQ.error.message);
  const used=new Set((recoveryQ.data||[]).map(x=>x.recovers_lesson_id).filter(Boolean)),available=(cancelledQ.data||[]).filter(x=>!used.has(x.id));
  if(!available.length){openModal('<h3>Lezione di recupero</h3><div class="empty">Non ci sono lezioni annullate ancora da recuperare.</div>');return;}
  openModal(`<h3>Nuova lezione di recupero</h3><label>Recupera<select id="recoveryOriginal">${available.map(x=>`<option value="${x.id}" ${x.id===preferredId?'selected':''}>${esc(groupName(x.group_id))} — ${fmtDate(x.lesson_date)}</option>`).join("")}</select></label><label>Data del recupero<input id="recoveryDate" type="date"></label><button onclick="saveRecovery()">Crea recupero</button>`);
};
window.saveRecovery = async () => { const originalId=$("recoveryOriginal").value,date=$("recoveryDate").value; if(!originalId||!date)return showMessage("Scegli la lezione e la data del recupero."); const q=await db.from("reg_lessons").select("*").eq("id",originalId).single(); if(q.error)return showMessage(q.error.message); const {error}=await db.from("reg_lessons").insert({group_id:q.data.group_id,lesson_date:date,kind:"recovery",status:"scheduled",recovers_lesson_id:originalId}); if(error)return showMessage(error.message); closeModal(); await renderToday(); };
window.deleteRecovery = async id => { if(!confirm("Eliminare questa lezione di recupero?"))return; const {error}=await db.from("reg_lessons").delete().eq("id",id); if(error)return showMessage(error.message); await renderToday(); };

function datesForProgramInRange(p,start,end) {
  const lo=p.start_date>start?p.start_date:start,hi=p.end_date<end?p.end_date:end; if(lo>hi)return[]; let d=parseDate(lo),wd=d.getDay(); wd=wd===0?7:wd; d.setDate(d.getDate()+((p.weekday-wd+7)%7)); const out=[];
  while(isoDate(d)<=hi){const s=isoDate(d); if(!isClosed(s))out.push(s); d.setDate(d.getDate()+7);} return out;
}
function scheduledOccurrences(start,end,onlyTeacherId=null) { const map=new Map(); for(const p of state.programs){if(onlyTeacherId&&p.teacher_id!==onlyTeacherId)continue; for(const date of datesForProgramInRange(p,start,end)){const key=`${p.group_id}|${date}`,old=map.get(key); if(!old||p.start_date>old.program.start_date)map.set(key,{date,program:p});}} return [...map.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.program.start_time.localeCompare(b.program.start_time)); }

async function renderCalendar() {
  const ym=$("calMonth").value||monthValueNow(),[y,m]=ym.split("-").map(Number),start=`${y}-${String(m).padStart(2,"0")}-01`,end=isoDate(new Date(y,m,0,12)),occ=scheduledOccurrences(start,end),q=await db.from("reg_lessons").select("*").gte("lesson_date",start).lte("lesson_date",end); if(q.error)return showMessage(q.error.message);
  const rows=q.data||[],regularMap=new Map(rows.filter(x=>x.kind==="regular").map(x=>[`${x.group_id}|${x.lesson_date}`,x])),recoveries=rows.filter(x=>x.kind==="recovery"),originalMap=await originalMapForRecoveries(recoveries),items=[];
  for(const o of occ){const row=regularMap.get(`${o.program.group_id}|${o.date}`); items.push({date:o.date,time:o.program.start_time,html:`<div class="lesson ${row?.status==="cancelled"?'cancelled':''}"><b>${esc(groupName(o.program.group_id))}</b><br>${o.program.start_time.slice(0,5)}–${o.program.end_time.slice(0,5)} · ${esc(teacherName(row?.substitute_teacher_id||o.program.teacher_id))} ${row?.status==="cancelled"?'<span class="tag cancel">annullata</span>':''} ${row?.substitute_teacher_id?'<span class="tag sub">cambio docente</span>':''}</div>`});}
  for(const r of recoveries){const expected=expectedTeacherForRecovery(r,originalMap),original=originalMap.get(r.recovers_lesson_id); items.push({date:r.lesson_date,time:"99:99",html:`<div class="lesson recovery"><b>${esc(groupName(r.group_id))}</b> <span class="tag recovery">RECUPERO</span><br>${original?'della lezione del '+fmtDate(original.lesson_date):''}<br>Docente: ${esc(teacherName(r.substitute_teacher_id||expected))}</div>`});}
  items.sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time)); let html="",last=""; for(const it of items){if(it.date!==last){html+=`<div class="calendar-day">${parseDate(it.date).toLocaleDateString("it-IT",{weekday:"long",day:"2-digit",month:"long"})}</div>`; last=it.date;} html+=it.html;} $("calendarList").innerHTML=html||'<div class="empty">Nessuna lezione nel mese selezionato.</div>';
}

async function loadPayments() {
  const groupId=$("payGroup").value,ym=$("payMonth").value||monthValueNow(); if(!groupId){$("paySummary").textContent=""; $("paymentsList").innerHTML='<div class="empty">Scegli un gruppo.</div>'; return;}
  const [y,m]=ym.split("-").map(Number),academicYear=academicYearForMonth(ym),studentsQ=await db.from("reg_students").select("*").eq("group_id",groupId).eq("active",true).order("name"); if(studentsQ.error)return showMessage(studentsQ.error.message); const students=studentsQ.data||[],ids=students.map(x=>x.id); let payments=[];
  if(ids.length){const payQ=await db.from("reg_payments").select("*").in("student_id",ids).eq("academic_year",academicYear).eq("month",m); if(payQ.error)return showMessage(payQ.error.message); payments=payQ.data||[];}
  const paid=new Set(payments.filter(x=>x.paid).map(x=>x.student_id)); $("paySummary").innerHTML=`<b>${MONTH_NAMES[m-1]} ${y}</b><br><span class="${paid.size===students.length&&students.length?'ok':'warn'}">${paid.size} / ${students.length} pagati</span>`;
  $("paymentsList").innerHTML=students.length?students.map(s=>`<label class="checkrow"><input type="checkbox" ${paid.has(s.id)?'checked':''} onchange="togglePayment('${s.id}','${academicYear}',${m},this.checked)"><span>${esc(s.name)}</span></label>`).join(""):'<div class="empty">Nessun ragazzo attivo nel gruppo.</div>';
}
window.togglePayment = async (studentId,academicYear,month,paid) => { const {error}=await db.from("reg_payments").upsert({student_id:studentId,academic_year:academicYear,month,paid,paid_at:paid?todayISO():null},{onConflict:"student_id,academic_year,month"}); if(error)return showMessage(error.message); await loadPayments(); };

async function lessonRowsRange(start,end) { const {data,error}=await db.from("reg_lessons").select("*").gte("lesson_date",start).lte("lesson_date",end); if(error)throw error; return data||[]; }
async function actualLessonsInRange(start,end,teacherId=null) {
  const occ=scheduledOccurrences(start,end),rows=await lessonRowsRange(start,end),regularMap=new Map(rows.filter(x=>x.kind==="regular").map(x=>[`${x.group_id}|${x.lesson_date}`,x])),recoveries=rows.filter(x=>x.kind==="recovery"&&x.status!=="cancelled"),originalMap=await originalMapForRecoveries(recoveries),out=[];
  for(const o of occ){const row=regularMap.get(`${o.program.group_id}|${o.date}`); if(row?.status==="cancelled")continue; const actual=row?.substitute_teacher_id||o.program.teacher_id; if(!teacherId||actual===teacherId)out.push({date:o.date,group_id:o.program.group_id,teacher_id:actual,kind:"regular"});}
  for(const r of recoveries){const expected=expectedTeacherForRecovery(r,originalMap),actual=r.substitute_teacher_id||expected; if(!teacherId||actual===teacherId)out.push({date:r.lesson_date,group_id:r.group_id,teacher_id:actual,kind:"recovery",original:originalMap.get(r.recovers_lesson_id)});}
  return out.sort((a,b)=>a.date.localeCompare(b.date));
}
function requireReportTeacher(){const id=$("reportTeacher").value;if(!id){showMessage("Scegli prima il docente.");return null;}return id;}
function setReport(text){$("reportOutput").textContent=text;$("copyReport").hidden=!text;}
async function buildMonthlyReport(){const teacherId=requireReportTeacher();if(!teacherId)return;const ym=$("reportMonth").value;if(!ym)return;const [y,m]=ym.split("-").map(Number),start=`${y}-${String(m).padStart(2,"0")}-01`,end=isoDate(new Date(y,m,0,12)),list=await actualLessonsInRange(start,end,teacherId),lines=list.map(x=>`${fmtShort(x.date)} – ${groupName(x.group_id)}${x.kind==="recovery"?' (recupero)':''}`);setReport(`${teacherName(teacherId).toUpperCase()} – ${MONTH_NAMES[m-1].toUpperCase()} ${y}\n\n${lines.length?lines.join("\n"):"Nessuna lezione svolta."}\n\nTOTALE LEZIONI ${MONTH_NAMES[m-1].toUpperCase()}: ${list.length}`);}
async function buildAnnualReport(){const teacherId=requireReportTeacher();if(!teacherId)return;const label=$("reportYear").value,{start,end}=academicRange(label),list=await actualLessonsInRange(start,end,teacherId),y0=Number(label.split("/")[0]),order=[9,10,11,12,1,2,3,4,5,6,7,8],parts=[];for(const m of order){const y=m>=9?y0:y0+1,subset=list.filter(x=>Number(x.date.slice(0,4))===y&&Number(x.date.slice(5,7))===m);if(!subset.length)continue;parts.push(`${MONTH_NAMES[m-1]}: ${subset.length} lezioni\n${subset.map(x=>'  '+fmtShort(x.date)+' – '+groupName(x.group_id)+(x.kind==="recovery"?' (recupero)':'')).join("\n")}`);}setReport(`${teacherName(teacherId).toUpperCase()} – ANNO ${label}\n\n${parts.length?parts.join("\n\n"):"Nessuna lezione svolta."}\n\nTOTALE LEZIONI ANNO ${label}: ${list.length}`);}

async function buildCommitmentReport(){
  const teacherId=requireReportTeacher();if(!teacherId)return;const label=$("reportYear").value,{start,end}=academicRange(label),own=scheduledOccurrences(start,end,teacherId),rows=await lessonRowsRange(start,end),regularMap=new Map(rows.filter(x=>x.kind==="regular").map(x=>[`${x.group_id}|${x.lesson_date}`,x]));let personal=0,cancelled=0,replaced=0;const detail=[],cancelledIds=[];
  for(const o of own){const row=regularMap.get(`${o.program.group_id}|${o.date}`);if(row?.status==="cancelled"){cancelled++;cancelledIds.push(row.id);detail.push(`${fmtShort(o.date)} – ${groupName(o.program.group_id)} – LEZIONE ANNULLATA`);}else if(row?.substitute_teacher_id&&row.substitute_teacher_id!==teacherId){replaced++;detail.push(`${fmtShort(o.date)} – ${groupName(o.program.group_id)} – svolta da ${teacherName(row.substitute_teacher_id)}`);}else personal++;}
  let recoveriesByOther=0;if(cancelledIds.length){const q=await db.from("reg_lessons").select("*").eq("kind","recovery").in("recovers_lesson_id",cancelledIds);if(q.error)return showMessage(q.error.message);const map=await originalMapForRecoveries(q.data||[]);for(const r of(q.data||[])){if(r.status==="cancelled")continue;const actual=r.substitute_teacher_id||expectedTeacherForRecovery(r,map);if(actual&&actual!==teacherId){recoveriesByOther++;const orig=map.get(r.recovers_lesson_id);detail.push(`${fmtShort(r.lesson_date)} – Recupero ${groupName(r.group_id)}${orig?' della lezione del '+fmtShort(orig.lesson_date):''} – svolto da ${teacherName(actual)}`);}}}
  setReport(`${teacherName(teacherId).toUpperCase()} – QUADRO IMPEGNI ${label}\n\nLezioni previste: ${own.length}\nLezioni svolte personalmente: ${personal}\nLezioni annullate: ${cancelled}\nLezioni con cambio docente: ${replaced}\nRecuperi svolti da altro docente: ${recoveriesByOther}\n\nDETTAGLIO ECCEZIONI\n${detail.length?detail.join("\n"):"Nessuna eccezione registrata."}`);
}

async function copyReport(){const text=$("reportOutput").textContent;if(!text)return;try{await navigator.clipboard.writeText(text);$("copyReport").textContent="✓ COPIATO";setTimeout(()=>$("copyReport").textContent="📋 COPIA REPORT",1200);}catch{showMessage("Non sono riuscito a copiare automaticamente il report.");}}
function openModal(html){$("modalBody").innerHTML=html;$("modal").hidden=false;}
function closeModal(){$("modal").hidden=true;$("modalBody").innerHTML="";}
window.closeModal=closeModal;

boot();
