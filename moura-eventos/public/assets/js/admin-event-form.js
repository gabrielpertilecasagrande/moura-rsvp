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

// ── Bloco de integração: mostra checkboxes (novo) ou IDs readonly (edição) ──
function initIntegrationBlock(event) {
  const newBlock  = document.getElementById('integrNewBlock');
  const editBlock = document.getElementById('integrEditBlock');
  if (isEdit) {
    newBlock.style.display  = 'none';
    editBlock.style.display = '';
    document.getElementById('rsvp_event_id').value    = event?.rsvp_event_id    || '';
    document.getElementById('checkin_event_id').value = event?.checkin_event_id || '';
    const hasRsvp    = !!event?.rsvp_event_id;
    const hasCheckin = !!event?.checkin_event_id;
    if (!hasRsvp || !hasCheckin) {
      document.getElementById('integrProvisionRow').style.display = '';
      if (!hasRsvp)    document.getElementById('provisionRsvpLabel').style.display    = 'flex';
      if (!hasCheckin) document.getElementById('provisionCheckinLabel').style.display = 'flex';
    }
    if (hasRsvp || hasCheckin) {
      document.getElementById('integrationSection').open = true;
    }
  } else {
    editBlock.style.display = 'none';
    newBlock.style.display  = '';
  }
}

// Botão "Provisionar agora" (modo edição)
document.getElementById('provisionNowBtn')?.addEventListener('click', async () => {
  const createRsvp    = document.getElementById('provisionRsvp')?.checked;
  const createCheckin = document.getElementById('provisionCheckin')?.checked;
  if (!createRsvp && !createCheckin) {
    toast('Selecione ao menos um sistema para provisionar.');
    return;
  }
  const btn = document.getElementById('provisionNowBtn');
  btn.disabled = true; btn.textContent = 'Provisionando…';
  try {
    const prov = await Api.post(`/api/integrations/provision-event/${editId}`, {
      create_rsvp:    createRsvp,
      create_checkin: createCheckin,
    });
    if (prov.errors?.length) {
      toast(`Erro: ${prov.errors.join('; ')}`);
    } else {
      toast('Provisionado com sucesso!');
      setTimeout(() => location.reload(), 800);
    }
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Provisionar agora';
  }
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
    initIntegrationBlock(event);
    updateWeekday();
  } else {
    initIntegrationBlock(null);
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
      // Provisionamento automático nos sistemas integrados
      const createRsvp    = document.getElementById('createRsvp')?.checked;
      const createCheckin = document.getElementById('createCheckin')?.checked;
      if (createRsvp || createCheckin) {
        btn.textContent = 'Provisionando…';
        try {
          const prov = await Api.post(`/api/integrations/provision-event/${event.id}`, {
            create_rsvp:    createRsvp,
            create_checkin: createCheckin,
          });
          if (prov.errors?.length) {
            toast(`Evento criado. Aviso: ${prov.errors.join('; ')}`);
          }
        } catch (e) {
          console.error('[provision]', e.message);
        }
      }
    }
    toast('Evento salvo.');
    setTimeout(() => location.href = `/admin/event-detail.html?id=${event.id}`, 600);
  } catch (e) {
    toast(e.message);
    btn.disabled = false; btn.textContent = 'Salvar evento';
  }
});

init().catch(console.error);
