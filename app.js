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
  $("commitmentReport"