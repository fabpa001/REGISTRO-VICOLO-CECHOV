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
function openTeacherModal(row,expected) { const active=state.teachers.filter(x=>x.active); openModal(`<h3>Cambio docente</h3><p class="muted">Docente previsto: <b>${esc(teacherName(expected))}</b></p><label>Lezione effettuata da<select id="modalTeacher"><option value="">Docente previsto</option>${active.map(t=>`<option value="${t.id}" ${t.id===row.substitute_teacher_id?'selected':''}>${esc(t.name)}</option>`).join("")}</select></label><button onclick="saveTeacherChange('${row.id}')">Salva</button>`); }
window.saveTeacherChange = async lessonId => { const id=$("modalTeacher").value||null; const {error}=await db.from("reg_lessons").update({substitute_teacher_id:id}).eq("id",lessonId); if(error)return showMessage(error.message); closeModal(); await renderToday(); };

window.openRecoveryModal = async preferredId => {
  const cancelledQ=await db.from("reg_lessons").select("*").eq("kind","regular").eq("status","cancelled").order("lesson_date"),recoveryQ=await db.from("reg_lessons").select("recovers_lesson_id").eq("kind","recovery"); if(cancelledQ.error)return showMessage(cancelledQ.error.message); if(recoveryQ.error)return showMessage(recoveryQ.error.message);
  const used=new Set((recoveryQ.data||[]).map(x=>x.recovers_lesson_id).filter(Boolean)),available=(cancelledQ.data||[]).filter(x=>!used.has(x.id)||x.id===preferredId);
  if(!available.length){openModal('<h3>Lezione di recupero</h3><div class="empty">Non ci sono lezioni annullate ancora da recuperare.</div>');return;}
  openModal(`<h3>Nuova lezione di recupero</h3><label>Recupera<select id="recoveryOriginal">${available.map(x=>`<option value="${x.id}" ${x.id===preferredId?'selected':''}>${esc(groupName(x.group_id))} — ${fmtDate(x.lesson_date)}</option>`).join("")}</select></label><label>Data del recupero<input id="recoveryDate" type="date"></label><button onclick="saveRecovery()">Crea recupero</button>`);
};
window.saveRecovery = async () => { const originalId=$("recoveryOriginal").value,date=$("recoveryDate").value; if(!originalId||!date)return showMessage("Scegli la lezione e la data del recupero."); const q=await db.from("reg_lessons").select("*").eq("id",originalId).single(); if(q.error)return showMessage(q.error.message); const {error}=await db.from("reg_lessons").insert({group_id:q.data.group_id,lesson_date:date,kind:"recovery",status:"scheduled",recovers_lesson_id:originalId}); if(error)return showMessage(error.message); closeModal(); await renderToday(); };
window.deleteRecovery = async id => { if(!confirm("Eliminare questa lezione di recupero?"))return; const {error}=await db.from("reg_lessons").delete().eq("id",id); if(error)return showMessage(error.message); await renderToday(); };

function datesForProgramInRange(p,st