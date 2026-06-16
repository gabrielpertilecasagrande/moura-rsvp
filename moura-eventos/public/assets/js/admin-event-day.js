requireSession();
const params = new URLSearchParams(location.search);
const eventId = params.get('id');
if (!eventId) location.href = '/admin/events.html';
document.getElementById('backLink').href = `/admin/event-detail.html?id=${eventId}`;

let evData = null;
let occData = [];
let hideDone = false;

function statusLabel(s) { return s || ''; }

async function load() {
  evData = await Api.get(`/api/events/${eventId}`);
  occData = await Api.get(`/api/events/${eventId}/crises`);

  const ev = evData.event;
  document.title = `Dia do Evento — ${ev.name}`;
  document.getElementById('evName').textContent = ev.name;
  const meta = [
    ev.event_date ? fmtDateBR(ev.event_date) : null,
    ev.event_time || null,
    ev.location || null,
    ev.city || null,
    ev.status,
  ].filter(Boolean).join('  ·  ');
  document.getElementById('evMeta').textContent = meta;

  renderChecklist();
  renderContacts();
  renderOccurrences();
}

// ── Checklist ao vivo ─────────────────────────────────────────────────────────
function renderChecklist() {
  let tasks = evData.checklist || [];
  const done = tasks.filter((t) => t.status === 'Concluído').length;
  document.getElementById('taskCount').textContent = `${done}/${tasks.length}`;

  if (hideDone) tasks = tasks.filter((t) => t.status !== 'Concluído');

  const el = document.getElementById('dayChecklist');
  if (!tasks.length) { el.innerHTML = '<div class="empty">Nenhuma tarefa.</div>'; return; }

  el.innerHTML = tasks.map((t) => {
    const isDone = t.status === 'Concluído';
    return `<div class="dtask ${isDone ? 'done' : ''}">
      <div class="dtask-check" onclick="toggleTask(${t.id}, ${isDone ? 'false' : 'true'})">${isDone ? '✓' : ''}</div>
      <div style="flex:1">
        <div class="dtask-title">${esc(t.title)}</div>
        ${t.responsible ? `<div class="dtask-resp">${esc(t.responsible)}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

async function toggleTask(tid, makeDone) {
  try {
    await Api.put(`/api/events/${eventId}/checklist/${tid}`, { status: makeDone ? 'Concluído' : 'Pendente' });
    const t = (evData.checklist || []).find((x) => x.id === tid);
    if (t) t.status = makeDone ? 'Concluído' : 'Pendente';
    renderChecklist();
  } catch (e) { toast(e.message); }
}

document.getElementById('hideDone').addEventListener('change', (e) => {
  hideDone = e.target.checked;
  renderChecklist();
});

// ── Contatos dos fornecedores ─────────────────────────────────────────────────
function waLink(num) {
  const digits = String(num || '').replace(/\D/g, '');
  if (!digits) return null;
  const full = digits.length <= 11 ? '55' + digits : digits;
  return `https://wa.me/${full}`;
}

function renderContacts() {
  const contracts = evData.contracts || [];
  document.getElementById('contactCount').textContent = `${contracts.length}`;
  const el = document.getElementById('dayContacts');
  if (!contracts.length) { el.innerHTML = '<div class="empty">Nenhuma contratação para este evento.</div>'; return; }

  el.innerHTML = contracts.map((c) => {
    const wa = waLink(c.whatsapp);
    return `<div class="contact">
      <div class="contact-info">
        <div class="contact-name">${esc(c.company)}</div>
        <div class="contact-sub">${[c.category, c.whatsapp].filter(Boolean).map(esc).join(' · ') || '—'}</div>
      </div>
      <div class="contact-btns">
        ${wa ? `<a class="cbtn wa" href="${wa}" target="_blank" title="WhatsApp" rel="noopener">🟢</a>` : ''}
        ${c.whatsapp ? `<a class="cbtn" href="tel:${esc(String(c.whatsapp).replace(/[^\d+]/g, ''))}" title="Ligar">📞</a>` : ''}
        ${c.email ? `<a class="cbtn" href="mailto:${esc(c.email)}" title="E-mail">✉️</a>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ── Ocorrências do dia ────────────────────────────────────────────────────────
function impactPill(i) {
  const m = { 'Alto': 'pill-no', 'Médio': 'pill-active', 'Baixo': '' };
  return `<span class="pill ${m[i] || ''}">${esc(i)}</span>`;
}
function crisisStatusPill(s) {
  const m = { 'Aberta': 'pill-no', 'Em tratamento': 'pill-active', 'Resolvida': 'pill-ok' };
  return `<span class="pill ${m[s] || ''}">${esc(s)}</span>`;
}

function renderOccurrences() {
  const open = occData.filter((c) => c.status !== 'Resolvida').length;
  document.getElementById('occCount').textContent = open ? `${open} em aberto` : `${occData.length}`;
  const el = document.getElementById('dayOccurrences');
  if (!occData.length) { el.innerHTML = '<div class="empty">Nenhuma ocorrência registrada.</div>'; return; }
  el.innerHTML = occData.map((c) => `<div class="occ-item">
    <div class="occ-meta">${c.occurred_at ? fmtDateTimeBR(c.occurred_at) : fmtDateTimeBR(c.created_at)} · ${impactPill(c.impact)} ${crisisStatusPill(c.status)}</div>
    <div class="occ-desc">${esc(c.description)}${c.responsible ? ` — <span class="muted">${esc(c.responsible)}</span>` : ''}</div>
  </div>`).join('');
}

async function addOccurrence() {
  const input = document.getElementById('occInput');
  const description = input.value.trim();
  if (!description) { toast('Descreva a ocorrência.'); return; }
  const now = new Date();
  const occurred_at = now.toISOString().slice(0, 16).replace('T', ' ');
  try {
    await Api.post(`/api/events/${eventId}/crises`, {
      description,
      impact: document.getElementById('occImpact').value,
      occurred_at,
      responsible: currentUser().name || null,
      status: 'Aberta',
    });
    input.value = '';
    toast('Ocorrência registrada.');
    occData = await Api.get(`/api/events/${eventId}/crises`);
    renderOccurrences();
  } catch (e) { toast(e.message); }
}

document.getElementById('occAddBtn').addEventListener('click', addOccurrence);
document.getElementById('occInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addOccurrence(); }
});

// Botão de atualizar reutilizável (recarrega tudo).
document.getElementById('refreshSlot').appendChild(refreshButton(load, 'Atualizar'));

load().catch(console.error);
