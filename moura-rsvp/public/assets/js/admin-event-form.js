requireSession();
mountShell('new');

const EDIT_ID = new URLSearchParams(location.search).get('id');
const FIELDS = [
  { key: 'company', label: 'Empresa' },
  { key: 'role', label: 'Cargo' },
  { key: 'email', label: 'E-mail' },
  { key: 'phone', label: 'Telefone/WhatsApp' },
];
let formConfig = {};

function renderBuilder() {
  document.getElementById('fieldBuilder').innerHTML = FIELDS.map((f) => {
    const c = formConfig[f.key] || { enabled: false, required: false };
    return `
    <div style="display:flex;align-items:center;gap:16px;padding:10px 0;border-bottom:1px solid var(--gray-soft)">
      <label style="display:flex;align-items:center;gap:8px;flex:1;margin:0;cursor:pointer">
        <input type="checkbox" data-k="${f.key}" data-t="enabled" ${c.enabled ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--navy)" />
        <span style="font-weight:600">${f.label}</span>
      </label>
      <label style="display:flex;align-items:center;gap:8px;margin:0;cursor:pointer;font-size:13px;color:var(--muted)">
        <input type="checkbox" data-k="${f.key}" data-t="required" ${c.required ? 'checked' : ''} ${c.enabled ? '' : 'disabled'} style="width:16px;height:16px;accent-color:var(--cyan)" />
        Obrigatório
      </label>
    </div>`;
  }).join('');

  document.querySelectorAll('#fieldBuilder input').forEach((inp) => {
    inp.addEventListener('change', () => {
      const k = inp.dataset.k, t = inp.dataset.t;
      formConfig[k] = formConfig[k] || { enabled: false, required: false, label: FIELDS.find((f) => f.key === k).label };
      formConfig[k][t] = inp.checked;
      if (t === 'enabled' && !inp.checked) formConfig[k].required = false;
      renderBuilder();
    });
  });
}

async function loadForEdit() {
  const e = await Api.get(`/api/events/${EDIT_ID}`);
  document.getElementById('eyebrow').textContent = 'Editar evento';
  document.getElementById('title').textContent = e.name;
  document.title = `${e.name} — Moura RSVP`;
  const set = (id, v) => { if (v != null) document.getElementById(id).value = v; };
  set('name', e.name); set('description', e.description); set('event_date', e.event_date);
  set('event_time', e.event_time); set('location', e.location); set('rsvp_deadline', e.rsvp_deadline);
  set('expected_guests', e.expected_guests); set('status', e.status);
  set('whatsapp', e.whatsapp);
  set('confirm_message', e.confirm_message); set('decline_message', e.decline_message);
  formConfig = e.form_config || {};
  const del = document.getElementById('deleteBtn');
  del.classList.remove('hidden');
  del.addEventListener('click', async () => {
    if (!confirm('Excluir este evento e todas as respostas? Esta ação não pode ser desfeita.')) return;
    await Api.del(`/api/events/${EDIT_ID}`);
    location.href = '/admin/dashboard.html';
  });
}

async function save() {
  const err = document.getElementById('err'); err.classList.add('hidden');
  const v = (id) => document.getElementById(id).value;
  if (!v('name').trim()) { err.textContent = 'Informe o nome do evento.'; err.classList.remove('hidden'); return; }

  const fd = new FormData();
  ['name', 'description', 'event_date', 'event_time', 'location', 'rsvp_deadline',
   'expected_guests', 'status', 'whatsapp', 'confirm_message', 'decline_message'].forEach((id) => fd.append(id, v(id)));
  fd.append('form_config', JSON.stringify(formConfig));
  const cover = document.getElementById('cover_image').files[0];
  const logo = document.getElementById('client_logo').files[0];
  if (cover) fd.append('cover_image', cover);
  if (logo) fd.append('client_logo', logo);

  const btn = document.getElementById('saveBtn'); btn.disabled = true; btn.textContent = 'Salvando…';
  try {
    const saved = EDIT_ID ? await Api.putForm(`/api/events/${EDIT_ID}`, fd) : await Api.postForm('/api/events', fd);
    location.href = `/admin/event-detail.html?id=${saved.id}`;
  } catch (e) {
    err.textContent = e.message; err.classList.remove('hidden');
    btn.disabled = false; btn.textContent = 'Salvar evento';
  }
}

document.getElementById('saveBtn').addEventListener('click', save);
renderBuilder();
if (EDIT_ID) loadForEdit().catch((e) => toast(e.message));
