requireSession();
mountShell('new');

const EDIT_ID = new URLSearchParams(location.search).get('id');
// Mostra o prefixo do link público ao lado do campo de slug.
const SLUG_PREFIX = `${location.origin}/rsvp/`;
{
  const sp = document.getElementById('slugPrefix');
  if (sp) sp.textContent = SLUG_PREFIX;
}
let removeCover = false, removeLogo = false;
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
  set('name', e.name); set('slug', e.slug); set('description', e.description); set('event_date', e.event_date);
  set('event_time', e.event_time); set('location', e.location); set('rsvp_deadline', e.rsvp_deadline);
  set('expected_guests', e.expected_guests); set('status', e.status);
  set('whatsapp', e.whatsapp);
  document.getElementById('whatsapp_enabled').checked = e.whatsapp_enabled == null ? true : !!e.whatsapp_enabled;
  set('confirm_message', e.confirm_message); set('decline_message', e.decline_message);
  formConfig = e.form_config || {};
  renderAttachment('coverCurrent', e.cover_image, 'cover');
  renderAttachment('logoCurrent', e.client_logo, 'logo');

  const del = document.getElementById('deleteBtn');
  del.classList.remove('hidden');
  del.addEventListener('click', () => confirmDelete(e.name));
  dirty = false; // carregar não conta como alteração
  maybeRestoreDraft();
}

// Preview do anexo atual com opção de remover.
function renderAttachment(slotId, url, which) {
  const slot = document.getElementById(slotId);
  if (!slot) return;
  if (!url) { slot.innerHTML = ''; return; }
  slot.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;padding:8px;border:1px solid var(--gray-soft);border-radius:8px;background:var(--off-white)">
      <img src="${url}" alt="" style="height:40px;width:auto;border-radius:4px;background:#fff" />
      <span class="muted" style="font-size:12px;flex:1">Anexo atual</span>
      <label style="display:flex;align-items:center;gap:6px;margin:0;font-size:12px;color:var(--danger);cursor:pointer">
        <input type="checkbox" id="rm_${which}" style="accent-color:var(--danger)" /> Remover
      </label>
    </div>
    <p class="muted" style="font-size:12px;margin:0 0 6px">Para trocar, selecione um novo arquivo abaixo.</p>`;
  const cb = document.getElementById(`rm_${which}`);
  cb.addEventListener('change', () => { if (which === 'cover') removeCover = cb.checked; else removeLogo = cb.checked; });
}

// Exclusão de evento com dupla verificação.
function confirmDelete(name) {
  const slot = document.getElementById('modalSlot') || (() => { const d = document.createElement('div'); d.id = 'modalSlot'; document.body.appendChild(d); return d; })();
  slot.innerHTML = `
    <div class="modal-bg"><div class="modal" style="text-align:left">
      <h3 style="font-size:17px;margin-bottom:6px;color:var(--danger)">Excluir evento</h3>
      <p style="font-size:14px;margin:0 0 12px">Você está prestes a excluir <strong>${esc(name || 'este evento')}</strong> e <strong>todas as respostas</strong>. Esta ação é permanente.</p>
      <p class="muted" style="font-size:13px;margin:0 0 8px">Para confirmar, digite <strong>EXCLUIR</strong> abaixo:</p>
      <input type="text" id="delConfirm" placeholder="EXCLUIR" autocomplete="off" />
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
        <button class="btn btn-ghost btn-sm" id="delCancel">Cancelar</button>
        <button class="btn btn-danger btn-sm" id="delGo" disabled>Excluir definitivamente</button>
      </div>
    </div></div>`;
  const input = document.getElementById('delConfirm');
  const go = document.getElementById('delGo');
  input.addEventListener('input', () => { go.disabled = input.value.trim().toUpperCase() !== 'EXCLUIR'; });
  document.getElementById('delCancel').addEventListener('click', () => { slot.innerHTML = ''; });
  go.addEventListener('click', async () => {
    go.disabled = true; go.textContent = 'Excluindo…';
    try { await Api.del(`/api/events/${EDIT_ID}`); location.href = '/admin/dashboard.html'; }
    catch (e) { toast(e.message); slot.innerHTML = ''; }
  });
}

async function save() {
  const err = document.getElementById('err'); err.classList.add('hidden');
  const v = (id) => document.getElementById(id).value;
  if (!v('name').trim()) { err.textContent = 'Informe o nome do evento.'; err.classList.remove('hidden'); return; }

  const fd = new FormData();
  ['name', 'slug', 'description', 'event_date', 'event_time', 'location', 'rsvp_deadline',
   'expected_guests', 'status', 'whatsapp', 'confirm_message', 'decline_message'].forEach((id) => fd.append(id, v(id)));
  fd.append('whatsapp_enabled', document.getElementById('whatsapp_enabled').checked ? '1' : '0');
  fd.append('form_config', JSON.stringify(formConfig));
  if (removeCover) fd.append('remove_cover', '1');
  if (removeLogo) fd.append('remove_logo', '1');
  const cover = document.getElementById('cover_image').files[0];
  const logo = document.getElementById('client_logo').files[0];
  if (cover) fd.append('cover_image', cover);
  if (logo) fd.append('client_logo', logo);

  const btn = document.getElementById('saveBtn'); btn.disabled = true; btn.textContent = 'Salvando…';
  try {
    const saved = EDIT_ID ? await Api.putForm(`/api/events/${EDIT_ID}`, fd) : await Api.postForm('/api/events', fd);
    dirty = false; clearDraft(); // salvou: não avisa mais sobre alterações
    location.href = `/admin/event-detail.html?id=${saved.id}`;
  } catch (e) {
    err.textContent = e.message; err.classList.remove('hidden');
    btn.disabled = false; btn.textContent = 'Salvar evento';
  }
}

// ---- Rascunho automático + aviso de alterações não salvas ----
const DRAFT_KEY = `moura_draft_${EDIT_ID || 'new'}`;
const TEXT_IDS = ['name', 'slug', 'description', 'event_date', 'event_time', 'location',
  'rsvp_deadline', 'expected_guests', 'status', 'whatsapp', 'confirm_message', 'decline_message'];
let dirty = false;
let draftT;

function collectDraft() {
  const d = { _t: Date.now(), wa_on: document.getElementById('whatsapp_enabled').checked, form_config: formConfig };
  TEXT_IDS.forEach((id) => { d[id] = document.getElementById(id).value; });
  return d;
}
function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(collectDraft())); } catch { /* ignora */ }
}
function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignora */ } }
function applyDraft(d) {
  TEXT_IDS.forEach((id) => { if (d[id] != null) document.getElementById(id).value = d[id]; });
  if (d.wa_on != null) document.getElementById('whatsapp_enabled').checked = d.wa_on;
  if (d.form_config) { formConfig = d.form_config; renderBuilder(); }
}
function maybeRestoreDraft() {
  let raw; try { raw = localStorage.getItem(DRAFT_KEY); } catch { return; }
  if (!raw) return;
  try {
    const d = JSON.parse(raw);
    if (confirm('Encontramos um rascunho não salvo deste evento. Deseja restaurar as alterações?')) {
      applyDraft(d); dirty = true;
    } else { clearDraft(); }
  } catch { /* ignora */ }
}

function markDirty() {
  dirty = true;
  clearTimeout(draftT);
  draftT = setTimeout(saveDraft, 800); // salva rascunho ~0,8s após parar de digitar
}

// Avisa ao tentar sair com alterações não salvas (fechar aba, navegar, etc.).
window.addEventListener('beforeunload', (e) => {
  if (dirty) { e.preventDefault(); e.returnValue = ''; }
});
// Monitora alterações em todos os campos do formulário.
document.addEventListener('input', (e) => {
  if (e.target.closest('.main')) markDirty();
});
document.addEventListener('change', (e) => {
  if (e.target.closest('.main')) markDirty();
});

document.getElementById('saveBtn').addEventListener('click', save);
renderBuilder();
if (EDIT_ID) loadForEdit().catch((e) => toast(e.message));
else maybeRestoreDraft();
