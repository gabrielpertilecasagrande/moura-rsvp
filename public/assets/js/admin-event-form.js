requireSession();
mountShell('new');

const EDIT_ID = new URLSearchParams(location.search).get('id');
let eventLoadedAt = null; // updated_at do evento quando foi aberto para edição
// Mostra o prefixo do link público ao lado do campo de slug.
const SLUG_PREFIX = `${location.origin}/rsvp/`;
{
  const sp = document.getElementById('slugPrefix');
  if (sp) sp.textContent = SLUG_PREFIX;
}
let removeCover = false, removeLogo = false;

// Configuração dos campos do formulário público — lista ordenada e editável.
const BUILTIN_FIELDS = [
  { key: 'company', label: 'Empresa', type: 'text' },
  { key: 'role', label: 'Cargo', type: 'text' },
  { key: 'email', label: 'E-mail', type: 'email' },
  { key: 'phone', label: 'Telefone/WhatsApp', type: 'tel' },
];
function defaultFields() {
  return BUILTIN_FIELDS.map((b) => ({ ...b, enabled: false, required: false, builtin: true }));
}
let formConfig = { fields: defaultFields() };

// Tipos de campos personalizados disponíveis.
const TYPE_LABELS = {
  text: 'Texto curto', textarea: 'Texto longo', number: 'Número', date: 'Data',
  select: 'Lista suspensa', radio: 'Botões de opção (uma escolha)',
  checkbox: 'Caixas de seleção (várias)', boolean: 'Sim / Não',
};
const OPTION_TYPES = ['select', 'radio', 'checkbox'];
const DRAG = '⠿'; // alça de arrastar

let dragFrom = null;

function renderBuilder() {
  const fields = formConfig.fields || (formConfig.fields = defaultFields());
  const wrap = document.getElementById('fieldBuilder');
  wrap.innerHTML = fields.map((f, i) => {
    const typeCell = f.builtin
      ? `<span class="fb-tag">padrão</span>`
      : `<select class="fb-type" data-act="type" data-i="${i}" title="Tipo do campo">
          ${Object.entries(TYPE_LABELS).map(([v, l]) => `<option value="${v}" ${f.type === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>`;
    const optionsCell = (!f.builtin && OPTION_TYPES.includes(f.type))
      ? `<div class="fb-options">
          <label>Opções (uma por linha)</label>
          <textarea data-act="options" data-i="${i}" rows="3" placeholder="Opção 1&#10;Opção 2">${esc((f.options || []).join('\n'))}</textarea>
        </div>` : '';
    return `
    <div class="fb-row" data-i="${i}" draggable="true">
      <span class="fb-drag" title="Arraste para reordenar" aria-hidden="true">${DRAG}</span>
      <label class="fb-enable" title="Exibir este campo no formulário">
        <input type="checkbox" data-act="enabled" data-i="${i}" ${f.enabled ? 'checked' : ''} />
      </label>
      <div class="fb-label">
        <input type="text" data-act="label" data-i="${i}" value="${esc(f.label)}" placeholder="Nome do campo" />
        ${typeCell}
      </div>
      <label class="fb-req" title="Tornar obrigatório">
        <input type="checkbox" data-act="required" data-i="${i}" ${f.required ? 'checked' : ''} ${f.enabled ? '' : 'disabled'} />
        <span>Obrigatório</span>
      </label>
      <button type="button" class="fb-del" data-act="remove" data-i="${i}" title="Excluir campo">✕</button>
      ${optionsCell}
    </div>`;
  }).join('') + `
    <button type="button" class="btn btn-ghost btn-sm fb-add" id="fbAddBtn" style="margin-top:14px">+ Adicionar outro campo</button>`;

  // Atualizações "silenciosas" (sem re-render) para não perder o foco ao digitar.
  wrap.querySelectorAll('[data-act="label"]').forEach((el) => {
    const i = Number(el.dataset.i);
    el.addEventListener('input', () => { fields[i].label = el.value; markDirty(); });
  });
  wrap.querySelectorAll('[data-act="options"]').forEach((el) => {
    const i = Number(el.dataset.i);
    el.addEventListener('input', () => {
      fields[i].options = el.value.split('\n').map((s) => s.trim()).filter(Boolean);
      markDirty();
    });
  });
  // Trocar o tipo re-renderiza (mostra/oculta o editor de opções).
  wrap.querySelectorAll('[data-act="type"]').forEach((el) => {
    const i = Number(el.dataset.i);
    el.addEventListener('change', () => {
      fields[i].type = el.value;
      if (OPTION_TYPES.includes(el.value) && !fields[i].options) fields[i].options = [];
      markDirty(); renderBuilder();
    });
  });
  // Demais ações (habilitar / obrigatório / excluir).
  wrap.querySelectorAll('[data-act="enabled"],[data-act="required"],[data-act="remove"]').forEach((el) => {
    const i = Number(el.dataset.i);
    const act = el.dataset.act;
    el.addEventListener('click', (ev) => {
      if (act === 'remove') { fields.splice(i, 1); }
      else if (act === 'enabled') { fields[i].enabled = el.checked; if (!el.checked) fields[i].required = false; }
      else if (act === 'required') { fields[i].required = el.checked; }
      if (act !== 'remove') ev.stopPropagation();
      markDirty(); renderBuilder();
    });
  });

  // ---- Reordenar arrastando (drag and drop) ----
  wrap.querySelectorAll('.fb-row').forEach((row) => {
    const i = Number(row.dataset.i);
    row.addEventListener('dragstart', (e) => { dragFrom = i; row.classList.add('fb-dragging'); e.dataTransfer.effectAllowed = 'move'; });
    row.addEventListener('dragend', () => { dragFrom = null; wrap.querySelectorAll('.fb-row').forEach((r) => r.classList.remove('fb-dragging', 'fb-over')); });
    row.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; row.classList.add('fb-over'); });
    row.addEventListener('dragleave', () => row.classList.remove('fb-over'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const to = Number(row.dataset.i);
      if (dragFrom == null || dragFrom === to) return;
      const [moved] = fields.splice(dragFrom, 1);
      fields.splice(to, 0, moved);
      dragFrom = null; markDirty(); renderBuilder();
    });
  });

  const addBtn = document.getElementById('fbAddBtn');
  if (addBtn) addBtn.addEventListener('click', () => {
    fields.push({ key: `c_${Date.now()}`, label: 'Novo campo', type: 'text', enabled: true, required: false, builtin: false, options: [] });
    markDirty(); renderBuilder();
  });
}

const PRESETS = {
  vegetariano: { label: 'Alimentação', type: 'select', options: ['Onívoro (como de tudo)', 'Vegetariano', 'Vegano', 'Outro'] },
  restricao:   { label: 'Restrição alimentar', type: 'text' },
  alergia:     { label: 'Alergias', type: 'text' },
  acessibilidade: { label: 'Necessidades de acessibilidade', type: 'select', options: ['Nenhuma', 'Cadeira de rodas', 'Deficiência visual', 'Deficiência auditiva', 'Outra'] },
  observacao:  { label: 'Observações', type: 'textarea' },
};

function addPreset(key) {
  if (key === 'acompanhante') {
    const fields = formConfig.fields || (formConfig.fields = []);
    const alreadyVem = fields.some((f) => f.key === 'c_acomp_vem');
    const alreadyNome = fields.some((f) => f.key === 'c_acomp_nome');
    if (alreadyVem || alreadyNome) { alert('Os campos de acompanhante já foram adicionados.'); return; }
    fields.push({ key: 'c_acomp_vem', label: 'Levará acompanhante?', type: 'boolean', enabled: true, required: false, builtin: false });
    fields.push({ key: 'c_acomp_nome', label: 'Nome do acompanhante', type: 'text', enabled: true, required: false, builtin: false });
    markDirty(); renderBuilder();
    document.getElementById('fieldBuilder').scrollIntoView({ behavior: 'smooth', block: 'end' });
    return;
  }
  const preset = PRESETS[key];
  if (!preset) return;
  const fields = formConfig.fields || (formConfig.fields = []);
  const already = fields.some((f) => !f.builtin && f.label === preset.label);
  if (already) { alert(`O campo "${preset.label}" já foi adicionado.`); return; }
  const field = { key: `c_${Date.now()}`, label: preset.label, type: preset.type, enabled: true, required: false, builtin: false };
  if (preset.options) field.options = [...preset.options];
  fields.push(field);
  markDirty(); renderBuilder();
  document.getElementById('fieldBuilder').scrollIntoView({ behavior: 'smooth', block: 'end' });
}

// Garante o formato { fields:[...] } a partir do que vier do backend/rascunho.
// Respeita a configuração existente (inclusive remoções de campos padrão).
function normalizeConfig(raw) {
  if (raw && Array.isArray(raw.fields) && raw.fields.length) {
    const fields = raw.fields.map((f) => {
      const builtin = BUILTIN_FIELDS.some((b) => b.key === f.key);
      const field = {
        key: f.key, label: f.label || '', type: f.type || 'text',
        enabled: !!f.enabled, required: !!f.enabled && !!f.required, builtin,
      };
      if (!builtin && OPTION_TYPES.includes(field.type)) field.options = Array.isArray(f.options) ? f.options.slice() : [];
      return field;
    });
    return { fields };
  }
  return { fields: defaultFields() };
}

async function loadForEdit() {
  const e = await Api.get(`/api/events/${EDIT_ID}`);
  eventLoadedAt = e.updated_at || null;
  document.getElementById('eyebrow').textContent = 'Editar evento';
  document.getElementById('title').textContent = e.name;
  document.title = `${e.name} — Moura RSVP`;
  const set = (id, v) => { if (v != null) document.getElementById(id).value = v; };
  set('name', e.name); set('slug', e.slug); set('description', e.description); set('event_date', e.event_date);
  set('event_time', e.event_time); set('location', e.location); set('rsvp_deadline', e.rsvp_deadline);
  set('city', e.city); set('address', e.address);
  set('expected_guests', e.expected_guests); set('status', e.status);
  set('whatsapp', e.whatsapp);
  document.getElementById('whatsapp_enabled').checked = e.whatsapp_enabled == null ? true : !!e.whatsapp_enabled;
  set('confirm_message', e.confirm_message); set('decline_message', e.decline_message);
  formConfig = normalizeConfig(e.form_config);
  renderBuilder();
  renderAttachment('coverCurrent', e.cover_image, 'cover');
  renderAttachment('logoCurrent', e.client_logo, 'logo');
  const landingOn = !!e.landing_enabled;
  document.getElementById('landing_enabled').checked = landingOn;
  document.getElementById('landingOptions').classList.toggle('hidden', !landingOn);
  landingConfig = normalizeLandingConfig(e.landing_config || {});
  renderLandingEditor();

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
  ['name', 'slug', 'description', 'event_date', 'event_time', 'location', 'city', 'address', 'rsvp_deadline',
   'expected_guests', 'status', 'whatsapp', 'confirm_message', 'decline_message'].forEach((id) => fd.append(id, v(id)));
  fd.append('whatsapp_enabled', document.getElementById('whatsapp_enabled').checked ? '1' : '0');
  fd.append('form_config', JSON.stringify(formConfig));
  fd.append('landing_enabled', document.getElementById('landing_enabled').checked ? '1' : '0');
  fd.append('landing_config', JSON.stringify(landingConfig));
  if (eventLoadedAt) fd.append('updated_at', eventLoadedAt);
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
const TEXT_IDS = ['name', 'slug', 'description', 'event_date', 'event_time', 'location', 'city', 'address',
  'rsvp_deadline', 'expected_guests', 'status', 'whatsapp', 'confirm_message', 'decline_message'];
let dirty = false;
let draftT;

function collectDraft() {
  const d = { _t: Date.now(), wa_on: document.getElementById('whatsapp_enabled').checked, form_config: formConfig,
    landing_on: document.getElementById('landing_enabled').checked, landing_config: landingConfig };
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
  if (d.form_config) { formConfig = normalizeConfig(d.form_config); renderBuilder(); }
  if (d.landing_on != null) {
    document.getElementById('landing_enabled').checked = d.landing_on;
    document.getElementById('landingOptions').classList.toggle('hidden', !d.landing_on);
  }
  if (d.landing_config) { landingConfig = normalizeLandingConfig(d.landing_config); renderLandingEditor(); }
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

// ---- Landing Page Premium ----

const LP_SECTION_DEFAULTS = [
  { type: 'video',     emoji: '🎥', label: 'Vídeo',                enabled: false, title: 'Sobre o evento',         url: '' },
  { type: 'agenda',    emoji: '📅', label: 'Agenda / Programação', enabled: false, title: 'Programação',            items: [] },
  { type: 'location',  emoji: '📍', label: 'Localização',          enabled: false, title: 'Localização',            embed_url: '' },
  { type: 'sponsors',  emoji: '🤝', label: 'Patrocinadores',        enabled: false, title: 'Patrocinadores',         items: [] },
  { type: 'faq',       emoji: '❓', label: 'Perguntas Frequentes',  enabled: false, title: 'Perguntas Frequentes',   items: [] },
];

let landingConfig = { sections: LP_SECTION_DEFAULTS.map((s) => ({ ...s, items: s.items ? [] : undefined })) };

function normalizeLandingConfig(raw) {
  try {
    const p = (raw && typeof raw === 'object') ? raw : JSON.parse(raw || '{}');
    const defByType = {};
    LP_SECTION_DEFAULTS.forEach((d) => { defByType[d.type] = d; });
    const merge = (def, saved) => {
      const base = { type: def.type, enabled: !!saved.enabled, title: saved.title || def.title };
      if (def.type === 'video')    return { ...base, url: saved.url || '' };
      if (def.type === 'location') return { ...base, embed_url: saved.embed_url || '' };
      return { ...base, items: Array.isArray(saved.items) ? saved.items : [] };
    };
    const savedSecs = (Array.isArray(p.sections) ? p.sections : []).filter((s) => defByType[s.type]);
    const savedTypes = new Set(savedSecs.map((s) => s.type));
    const extra = LP_SECTION_DEFAULTS.filter((d) => !savedTypes.has(d.type))
      .map((d) => merge(d, {}));
    return { sections: [...savedSecs.map((s) => merge(defByType[s.type], s)), ...extra] };
  } catch { return { sections: LP_SECTION_DEFAULTS.map((d) => ({ ...d, items: d.items ? [] : undefined })) }; }
}

let lpDragFrom = null;

function renderLandingEditor() {
  const el = document.getElementById('landingEditor');
  if (!el) return;
  el.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:8px">
      <button type="button" id="lpResetOrder" class="btn-link-muted" title="Volta à ordem original: Vídeo, Agenda, Localização, Patrocinadores, FAQ">redefinir ordem</button>
    </div>
    ${landingConfig.sections.map((sec) => renderLpSection(sec)).join('')}`;

  document.getElementById('lpResetOrder').addEventListener('click', () => {
    const order = LP_SECTION_DEFAULTS.map((d) => d.type);
    landingConfig.sections.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
    markDirty(); renderLandingEditor();
  });

  el.querySelectorAll('.lp-ed-head').forEach((head) => {
    head.addEventListener('click', (e) => {
      if (e.target.closest('input[type=checkbox]') || e.target.closest('.lp-ed-drag')) return;
      head.closest('.lp-ed-section').classList.toggle('open');
    });
  });
  el.querySelectorAll('[data-lp-enabled]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const sec = landingConfig.sections.find((s) => s.type === cb.dataset.lpEnabled);
      if (sec) { sec.enabled = cb.checked; markDirty(); }
    });
  });
  el.querySelectorAll('[data-lp-title]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const sec = landingConfig.sections.find((s) => s.type === inp.dataset.lpTitle);
      if (sec) { sec.title = inp.value; markDirty(); }
    });
  });
  el.querySelectorAll('[data-lp-url]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const sec = landingConfig.sections.find((s) => s.type === inp.dataset.lpUrl);
      if (sec) { sec.url = inp.value; markDirty(); }
    });
  });
  el.querySelectorAll('[data-lp-embed]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const sec = landingConfig.sections.find((s) => s.type === inp.dataset.lpEmbed);
      if (sec) { sec.embed_url = inp.value; markDirty(); }
    });
  });
  el.querySelectorAll('[data-lp-add]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.lpAdd;
      const sec = landingConfig.sections.find((s) => s.type === type);
      if (!sec) return;
      if (type === 'agenda')   sec.items.push({ time: '', title: '', description: '' });
      if (type === 'sponsors') sec.items.push({ name: '', logo_url: '', website: '' });
      if (type === 'faq')      sec.items.push({ question: '', answer: '' });
      markDirty(); renderLandingEditor();
    });
  });
  el.querySelectorAll('[data-lp-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [type, idx] = btn.dataset.lpDel.split(':');
      const sec = landingConfig.sections.find((s) => s.type === type);
      if (sec) { sec.items.splice(Number(idx), 1); markDirty(); renderLandingEditor(); }
    });
  });
  el.querySelectorAll('[data-lp-field]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const [type, idx, field] = inp.dataset.lpField.split(':');
      const sec = landingConfig.sections.find((s) => s.type === type);
      if (sec && sec.items[Number(idx)]) { sec.items[Number(idx)][field] = inp.value; markDirty(); }
    });
  });

  // ---- Drag-and-drop para reordenar seções ----
  el.querySelectorAll('.lp-ed-section[data-lp-type]').forEach((row) => {
    const type = row.dataset.lpType;
    row.addEventListener('dragstart', (e) => {
      lpDragFrom = type; row.classList.add('lp-ed-dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => {
      lpDragFrom = null;
      el.querySelectorAll('.lp-ed-section').forEach((r) => r.classList.remove('lp-ed-dragging', 'lp-ed-over'));
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      if (lpDragFrom && lpDragFrom !== type) row.classList.add('lp-ed-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('lp-ed-over'));
    row.addEventListener('drop', (e) => {
      e.preventDefault(); row.classList.remove('lp-ed-over');
      if (!lpDragFrom || lpDragFrom === type) return;
      const fromIdx = landingConfig.sections.findIndex((s) => s.type === lpDragFrom);
      const toIdx   = landingConfig.sections.findIndex((s) => s.type === type);
      if (fromIdx < 0 || toIdx < 0) return;
      const [moved] = landingConfig.sections.splice(fromIdx, 1);
      landingConfig.sections.splice(toIdx, 0, moved);
      lpDragFrom = null; markDirty(); renderLandingEditor();
    });
    row.querySelector('.lp-ed-drag')?.addEventListener('mousedown', (e) => e.stopPropagation());
  });
}

function renderLpSection(sec) {
  const def = LP_SECTION_DEFAULTS.find((d) => d.type === sec.type) || {};
  const inner = renderLpSectionBody(sec);
  return `
  <div class="lp-ed-section${sec.enabled ? ' open' : ''}" data-lp-type="${sec.type}" draggable="true">
    <div class="lp-ed-head">
      <div class="lp-ed-head-label">
        <span class="lp-ed-drag" title="Arraste para reordenar" aria-hidden="true">${DRAG}</span>
        <span>${def.emoji || ''} ${def.label || sec.type}</span>
      </div>
      <div style="display:flex;align-items:center;gap:14px">
        <label class="lp-ed-head-toggle" onclick="event.stopPropagation()">
          <input type="checkbox" data-lp-enabled="${sec.type}" ${sec.enabled ? 'checked' : ''} style="accent-color:var(--navy)" />
          <span>Ativar</span>
        </label>
        <svg class="lp-ed-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg>
      </div>
    </div>
    <div class="lp-ed-body">${inner}</div>
  </div>`;
}

function renderLpSectionBody(sec) {
  const titleField = `<div class="field"><label>Título da seção</label><input type="text" data-lp-title="${sec.type}" value="${esc(sec.title || '')}" /></div>`;
  if (sec.type === 'video') {
    return `${titleField}
    <div class="field">
      <label>URL do vídeo (YouTube ou Vimeo)</label>
      <input type="text" data-lp-url="video" value="${esc(sec.url || '')}" placeholder="https://www.youtube.com/watch?v=..." />
      <p class="muted" style="font-size:12px;margin:4px 0 0">Cole o link normal do YouTube ou Vimeo. O embed é gerado automaticamente.</p>
    </div>`;
  }
  if (sec.type === 'location') {
    return `${titleField}
    <div class="field">
      <label>URL de incorporação do Google Maps</label>
      <input type="text" data-lp-embed="location" value="${esc(sec.embed_url || '')}" placeholder="https://www.google.com/maps/embed?pb=..." />
      <p class="muted" style="font-size:12px;margin:4px 0 0">No Google Maps: Compartilhar → Incorporar um mapa → copie apenas a URL do atributo <code>src</code> do iframe.</p>
    </div>`;
  }
  if (sec.type === 'agenda') {
    const rows = (sec.items || []).map((it, i) => `
      <div class="lp-ed-item" style="grid-template-columns:80px 1fr;align-items:start">
        <button type="button" class="lp-ed-del" data-lp-del="agenda:${i}" title="Remover">✕</button>
        <div class="field" style="margin:0"><label style="font-size:12px">Horário</label><input type="text" data-lp-field="agenda:${i}:time" value="${esc(it.time || '')}" placeholder="19:00" /></div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <div class="field" style="margin:0"><label style="font-size:12px">Título do item</label><input type="text" data-lp-field="agenda:${i}:title" value="${esc(it.title || '')}" placeholder="Abertura do evento" /></div>
          <div class="field" style="margin:0"><label style="font-size:12px">Descrição (opcional)</label><input type="text" data-lp-field="agenda:${i}:description" value="${esc(it.description || '')}" placeholder="Breve descrição" /></div>
        </div>
      </div>`).join('');
    return `${titleField}<div class="lp-ed-items">${rows}</div>
      <button type="button" class="btn btn-ghost btn-sm" data-lp-add="agenda">+ Adicionar item</button>`;
  }
  if (sec.type === 'sponsors') {
    const rows = (sec.items || []).map((it, i) => `
      <div class="lp-ed-item" style="grid-template-columns:1fr 1fr 1fr">
        <button type="button" class="lp-ed-del" data-lp-del="sponsors:${i}" title="Remover">✕</button>
        <div class="field" style="margin:0"><label style="font-size:12px">Nome</label><input type="text" data-lp-field="sponsors:${i}:name" value="${esc(it.name || '')}" placeholder="Empresa X" /></div>
        <div class="field" style="margin:0"><label style="font-size:12px">URL do logo (imagem)</label><input type="text" data-lp-field="sponsors:${i}:logo_url" value="${esc(it.logo_url || '')}" placeholder="https://..." /></div>
        <div class="field" style="margin:0"><label style="font-size:12px">Site (opcional)</label><input type="text" data-lp-field="sponsors:${i}:website" value="${esc(it.website || '')}" placeholder="https://empresax.com.br" /></div>
      </div>`).join('');
    return `${titleField}<div class="lp-ed-items">${rows}</div>
      <button type="button" class="btn btn-ghost btn-sm" data-lp-add="sponsors">+ Adicionar patrocinador</button>`;
  }
  if (sec.type === 'faq') {
    const rows = (sec.items || []).map((it, i) => `
      <div class="lp-ed-item" style="grid-template-columns:1fr">
        <button type="button" class="lp-ed-del" data-lp-del="faq:${i}" title="Remover">✕</button>
        <div class="field" style="margin:0"><label style="font-size:12px">Pergunta</label><input type="text" data-lp-field="faq:${i}:question" value="${esc(it.question || '')}" placeholder="Como funciona o check-in?" /></div>
        <div class="field" style="margin:0"><label style="font-size:12px">Resposta</label><textarea data-lp-field="faq:${i}:answer" rows="2" placeholder="Resposta detalhada...">${esc(it.answer || '')}</textarea></div>
      </div>`).join('');
    return `${titleField}<div class="lp-ed-items">${rows}</div>
      <button type="button" class="btn btn-ghost btn-sm" data-lp-add="faq">+ Adicionar pergunta</button>`;
  }
  return titleField;
}

// Inicializa o toggle de landing e re-renderiza o editor quando muda.
document.getElementById('landing_enabled').addEventListener('change', function () {
  document.getElementById('landingOptions').classList.toggle('hidden', !this.checked);
  markDirty();
});

document.getElementById('saveBtn').addEventListener('click', save);
renderBuilder();
renderLandingEditor();
if (EDIT_ID) loadForEdit().catch((e) => toast(e.message));
else maybeRestoreDraft();
