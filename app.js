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
  $("studentsList").innerHTML