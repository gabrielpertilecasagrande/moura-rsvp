requireSession();

const params = new URLSearchParams(location.search);
const editId = params.get('id');
const isEdit = !!editId;

mountShell(isEdit ? 'events' : 'events');

if (!canCreateEvents()) {
  toast('Você não tem permissão para criar ou editar eventos.');
  setTimeout(() => location.href = '/admin/events.html', 1500);
}

const PRIORITY_COLORS = { 'Crítica': '#e63946', 'Alta': '#f4a261', 'Média': '#2BC2CE', 'Baixa': '#8b9099' };
const WEEKDAYS = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
const MONTHS   = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

function updateWeekday() {
  const val = document.getElementById('event_date').value;
  const el  = document.getElementById('weekdayLabel');
  if (!el) return;
  if (!val) { el.textContent = ''; return; }
  const [y, m, d] = val.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  el.textContent = `${WEEKDAYS[dt.getDay()]}, ${d} de ${MONTHS[m - 1]} de ${y}`;
}

document.getElementById('event_date').addEventListener('change', updateWeekday);
fillLocationDatalists();

async function loadTemplatePreview(type) {
  const preview = document.getElementById('templatePreview');
  const list    = document.getElementById('templateList');
  if (!type) { preview.style.display = 'none'; return; }
  try {
    const tasks = await Api.get(`/api/events/templates/${encodeURIComponent(type)}`);
    if (!tasks.length) { preview.style.display = 'none'; return; }
    list.innerHTML = tasks.map(t => {
      const color = PRIORITY_COLORS[t.priority] || 'var(--navy)';
      return `<div style="display:flex;align-items:center;gap:8px;font-size:13px">
        <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>
        <span>${esc(t.title)}</span>
        <span style="color:${color};font-size:11px;font-weight:600">${esc(t.priority)}</span>
      </div>`;
    }).join('');
    preview.style.display = 'block';
  } catch { preview.style.display = 'none'; }
}

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

document.getElementById('event_type').addEventListener('change', function() {
  if (!isEdit) loadTemplatePreview(this.value);
});

async function init() {
  if (isEdit) {
    document.getElementById('formEyebrow').textContent = 'Editar';
    document.getElementById('formTitle').textContent = 'Editar Evento';
    const { event } = await Api.get(`/api/events/${editId}`);
    document.getElementById('name').value        = event.name        || '';
    document.getElementById('client').value      = event.client      || '';
    document.getElementById('event_date').value  = event.event_date  || '';
    document.getElementById('event_time').value  = event.event_time  || '';
    document.getElementById('location').value    = event.location    || '';
    document.getElementById('city').value        = event.city        || '';
    document.getElementById('responsible').value = event.responsible || '';
    document.getElementById('status').value      = event.status      || 'Planejamento';
    document.getElementById('event_type').value  = event.event_type  || '';
    updateWeekday();
  }
}

document.getElementById('saveBtn').addEventListener('click', async () => {
  const name = document.getElementById('name').value.trim();
  if (!name) { toast('Informe o nome do evento.'); return; }

  const body = {
    name,
    client:      document.getElementById('client').value.trim()      || null,
    event_date:  document.getElementById('event_date').value         || null,
    event_time:  document.getElementById('event_time').value         || null,
    location:    document.getElementById('location').value.trim()    || null,
    city:        document.getElementById('city').value.trim()        || null,
    responsible: document.getElementById('responsible').value.trim() || null,
    status:      document.getElementById('status').value,
    event_type:  document.getElementById('event_type').value         || null,
  };

  const btn = document.getElementById('saveBtn');
  btn.disabled = true; btn.textContent = 'Salvando…';

  try {
    let event;
    if (isEdit) {
      event = await Api.put(`/api/events/${editId}`, body);
    } else {
      event = await Api.post('/api/events', body);
    }
    toast('Evento salvo.');
    setTimeout(() => location.href = `/admin/event-detail.html?id=${event.id}`, 600);
  } catch (e) {
    toast(e.message);
    btn.disabled = false; btn.textContent = 'Salvar evento';
  }
});

init().catch(console.error);
