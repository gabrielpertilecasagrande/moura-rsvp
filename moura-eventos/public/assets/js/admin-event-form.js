requireSession();

const params = new URLSearchParams(location.search);
const editId = params.get('id');
const isEdit = !!editId;

mountShell(isEdit ? 'events' : 'events');

if (!canCreateEvents()) {
  toast('Você não tem permissão para criar ou editar eventos.');
  setTimeout(() => location.href = '/admin/events.html', 1500);
}

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
