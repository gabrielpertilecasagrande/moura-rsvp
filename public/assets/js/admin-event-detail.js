requireSession();
mountShell();

const ID = new URLSearchParams(location.search).get('id');
let state = { filter: '', q: '' };
let EVENT = null;

// Permissão efetiva do usuário neste evento (admin recebe tudo do backend).
function can(perm) { return !!(EVENT && EVENT._perms && EVENT._perms[perm]); }

// Mostra/oculta um elemento por id conforme a permissão.
function gate(id, allowed) { const el = document.getElementById(id); if (el) el.style.display = allowed ? '' : 'none'; }

// Aplica as permissões aos botões fixos do cabeçalho e da barra de ferramentas.
function applyPermissions() {
  gate('editBtn', can('can_edit'));
  gate('dupBtn', can('can_duplicate'));
  gate('addOneBtn', can('can_participants'));
  gate('addBulkBtn', can('can_participants'));
  const exp = document.querySelector('.export-group');
  if (exp) exp.style.display = can('can_export') ? '' : 'none';
}

async function loadEvent() {
  EVENT = await Api.get(`/api/events/${ID}`);
  document.getElementById('evName').textContent = EVENT.name;
  document.title = `${EVENT.name} — Moura RSVP`;
  document.getElementById('evMeta').textContent =
    `${EVENT.event_date ? fmtDateBR(EVENT.event_date) : 'Data a definir'}${EVENT.event_time ? ' · ' + EVENT.event_time : ''}${EVENT.location ? ' · ' + EVENT.location : ''}`;
  document.getElementById('openPublic').href = EVENT.public_url;
  document.getElementById('editBtn').href = `/admin/event-form.html?id=${ID}`;
  applyPermissions();
  renderReopenBanner();
}

// Verifica se o prazo passou (apenas data).
function deadlineGone() {
  if (!EVENT.rsvp_deadline) return false;
  return Date.now() > new Date(`${EVENT.rsvp_deadline}T23:59:59`).getTime();
}

function renderReopenBanner() {
  const wrap = document.getElementById('reopenBanner');
  const past = deadlineGone();
  const reopened = !!EVENT.force_open;
  // Só mostra quando há algo a decidir: prazo passou OU já está reaberto.
  if (!past && !reopened) { wrap.innerHTML = ''; return; }
  if (reopened) {
    wrap.innerHTML = `
      <div class="card" style="margin-bottom:18px;border-left:4px solid var(--cyan);display:flex;gap:14px;flex-wrap:wrap;align-items:center;justify-content:space-between">
        <div><strong>Confirmações reabertas.</strong> <span class="muted">As pessoas podem responder mesmo com o prazo encerrado.</span></div>
        ${can('can_edit') ? '<button class="btn btn-ghost btn-sm" onclick="setReopen(false)">Encerrar novamente</button>' : ''}
      </div>`;
  } else {
    wrap.innerHTML = `
      <div class="card" style="margin-bottom:18px;border-left:4px solid var(--danger);display:flex;gap:14px;flex-wrap:wrap;align-items:center;justify-content:space-between">
        <div><strong>Prazo encerrado.</strong> <span class="muted">A página pública não aceita novas respostas.</span></div>
        ${can('can_edit') ? '<button class="btn btn-primary btn-sm" onclick="setReopen(true)">Reabrir confirmações</button>' : ''}
      </div>`;
  }
}

async function setReopen(open) {
  try {
    await Api.req('PATCH', `/api/events/${ID}/reopen`, { open });
    EVENT.force_open = open ? 1 : 0;
    renderReopenBanner();
    toast(open ? 'Confirmações reabertas.' : 'Confirmações encerradas.');
  } catch (e) { toast(e.message); }
}

async function loadParticipants() {
  const params = new URLSearchParams();
  if (state.filter) params.set('filter', state.filter);
  if (state.q) params.set('q', state.q);
  const data = await Api.get(`/api/events/${ID}/participants?${params}`);
  renderQuickSummary(data.stats);
  renderStats(data.stats);
  renderRows(data.participants);
}

function deadlineTag() {
  if (EVENT.status !== 'ativo') return '<span class="deadline-tag deadline-red">Evento inativo</span>';
  if (!EVENT.rsvp_deadline) return '<span class="deadline-tag deadline-green">Sem prazo definido</span>';
  const end = new Date(`${EVENT.rsvp_deadline}T23:59:59`).getTime();
  const days = Math.ceil((end - Date.now()) / 86400000);
  if (Date.now() > end) {
    return EVENT.force_open
      ? '<span class="deadline-tag deadline-amber">Reaberto (prazo vencido)</span>'
      : '<span class="deadline-tag deadline-red">Prazo encerrado</span>';
  }
  if (days <= 7) return `<span class="deadline-tag deadline-amber">Faltam ${days} dia(s)</span>`;
  return '<span class="deadline-tag deadline-green">Prazo aberto</span>';
}

function renderQuickSummary(s) {
  const rate = s.expected_guests > 0 ? Math.round((s.total / s.expected_guests) * 100) + '%' : '—';
  document.getElementById('quickSummary').innerHTML = `
    <div class="quick-summary">
      <div class="qs"><span class="k">Data</span><span class="v">${EVENT.event_date ? fmtDateBR(EVENT.event_date) : 'A definir'}${EVENT.event_time ? ' · ' + EVENT.event_time : ''}</span></div>
      <div class="qs"><span class="k">Local</span><span class="v">${[EVENT.location, EVENT.city].filter(Boolean).map(esc).join(' · ') || '—'}</span></div>
      <div class="qs"><span class="k">Convidados esperados</span><span class="v">${EVENT.expected_guests || '—'}</span></div>
      <div class="qs"><span class="k">Taxa de resposta</span><span class="v">${rate}</span></div>
      <div class="qs"><span class="k">Prazo</span><span class="v">${deadlineTag()}</span></div>
    </div>
    <div class="qs-link">
      <div style="flex:1;min-width:200px">
        <span class="k" style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:600">Link público</span>
        <div class="break-anywhere" style="font-size:13.5px;color:var(--navy);font-weight:500">${esc(EVENT.public_url)}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-accent btn-sm" onclick="copyLink()">Copiar link</button>
        <button class="btn btn-ghost btn-sm" onclick="openQr()">QR Code</button>
      </div>
    </div>`;
}

// Cor dinâmica para taxas: <50 vermelho, 50-79 laranja, 80+ verde.
function rateTone(pct) { if (pct >= 80) return 'green'; if (pct >= 50) return 'amber'; return 'red'; }

const STAT_ICONS = {
  respostas: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  rate: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>',
};

function statCard(d) {
  const tip = d.tip ? `<span class="info-i" title="${d.tip}">i</span>` : '';
  return `<div class="stat tone-${d.tone}">
    <div class="stat-top"><span class="stat-ico">${d.ico || ''}</span><span class="l">${d.l}${tip}</span></div>
    <div class="n">${d.n}</div>
  </div>`;
}

function renderStats(s) {
  const adesao = s.confirmation_rate;
  const defs = [
    { n: s.total, l: 'Respostas', tone: 'navy', ico: STAT_ICONS.respostas },
    { n: s.confirmed, l: 'Confirmados', tone: 'green', ico: STAT_ICONS.check },
    { n: s.declined, l: 'Recusas', tone: s.declined > 0 ? 'red' : 'gray', ico: STAT_ICONS.x },
    { n: adesao + '%', l: 'Índice de adesão', tone: rateTone(adesao), ico: STAT_ICONS.rate,
      tip: 'Proporção de quem confirmou entre todos que responderam. Ex.: 62 confirmados de 65 respostas = 95%.' },
  ];
  document.getElementById('pStats').innerHTML = defs.map(statCard).join('');
}

// Monta link wa.me a partir do telefone do convidado.
function guestWa(phone) {
  if (!phone) return null;
  let d = String(phone).replace(/\D/g, '');
  if (!d) return null;
  if (d.length <= 11 && !d.startsWith('55')) d = '55' + d;
  return `https://wa.me/${d}`;
}

let LAST_LIST = [];
const SELECTED = new Set();
function renderRows(list) {
  LAST_LIST = list;
  const tb = document.getElementById('rows');
  if (!list.length) {
    tb.innerHTML = `<tr><td colspan="4" class="muted center" style="padding:30px">Nenhuma resposta encontrada${state.q || state.filter ? ' com os filtros aplicados' : ' ainda'}.</td></tr>`;
    return;
  }
  const selectable = can('can_participants') || can('can_export');
  tb.innerHTML = list.map((p) => {
    const wa = guestWa(p.phone);
    const ex = parseExtra(p.extra);
    const customVals = eventCustomFields().map((f) => fmtExtraVal(f, ex[f.key])).filter(Boolean);
    const sub = [p.company, p.phone, p.email, ...customVals].filter(Boolean).map(esc).join(' · ');
    const noteLine = (p.notes && can('can_participants')) ? `<div class="p-note">📝 ${esc(p.notes)}</div>` : '';
    const icon = (svg, label, attrs) => `<button class="icon-btn" title="${label}" aria-label="${label}" ${attrs}>${svg}</button>`;
    return `
    <tr data-pid="${p.id}">
      <td class="col-check">${selectable ? `<input type="checkbox" class="row-check" value="${p.id}" ${SELECTED.has(p.id) ? 'checked' : ''} aria-label="Selecionar ${esc(p.name)}" />` : ''}</td>
      <td class="row-name" style="display:block">
        <div class="p-name">${esc(p.name)}</div>
        ${sub ? `<div class="p-sub muted break-anywhere">${sub}</div>` : ''}
        ${noteLine}
      </td>
      <td data-label="Status"><span class="pill ${p.response === 'confirmado' ? 'pill-ok' : 'pill-no'}">${p.response === 'confirmado' ? 'Confirmado' : 'Recusado'}</span></td>
      <td data-label="Resposta" style="white-space:nowrap;font-variant-numeric:tabular-nums">${fmtDateTimeBR(p.updated_at)}</td>
      <td class="cell-actions" style="text-align:right">
        ${can('can_participants') ? icon(IC.edit, 'Editar', `onclick="editParticipant(${p.id})"`) : ''}
        ${can('can_history') ? icon(IC.history, 'Histórico', `onclick="showAudit(${p.id})"`) : ''}
        ${wa && can('can_messages') ? `<a class="icon-btn icon-wa" title="WhatsApp" aria-label="WhatsApp" href="${wa}" target="_blank" rel="noopener"><img src="/assets/img/whatsapp.png" alt="WhatsApp" width="18" height="18" style="display:block" /></a>` : ''}
        ${can('can_participants') ? icon(IC.trash, 'Remover', `onclick="deleteParticipant(${p.id})"`) : ''}
      </td>
    </tr>`;
  }).join('');
  // Esconde o "selecionar todos" quando não há ações em lote disponíveis.
  const checkAll = document.getElementById('checkAll');
  if (checkAll) checkAll.style.display = selectable ? '' : 'none';
  syncSelectionUI();
}

// Ícones (SVG) para as ações
const IC = {
  edit: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  history: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>',
  wa: '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.7-.8-1.9-.9-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-1.6-.8-2.6-1.4-3.7-3.2-.3-.5.3-.5.8-1.5.1-.2 0-.4 0-.5 0-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.1 4.9 4.3 1.8.8 2.5.8 3.4.7.5-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3M12 2a10 10 0 0 0-8.6 15l-1.4 5 5.1-1.3A10 10 0 1 0 12 2"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
};

const fieldRow = (id, label, value, type = 'text') =>
  `<div class="field" style="text-align:left"><label>${label}</label><input type="${type}" id="${id}" value="${esc(value) || ''}" /></div>`;

// ---- Campos personalizados ("outro") configurados no evento ----
function eventCustomFields() {
  return ((EVENT && EVENT.form_config && EVENT.form_config.fields) || []).filter((f) => f.enabled && !f.builtin);
}
function parseExtra(raw) {
  try { return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {}; } catch { return {}; }
}
// Texto legível de um valor de campo personalizado (arrays viram "a, b").
function fmtExtraVal(f, val) {
  if (val == null) return '';
  if (Array.isArray(val)) return val.join(', ');
  return String(val);
}
// Controle de edição de um campo personalizado conforme o tipo, já preenchido.
function customFieldControl(f, ex) {
  const v = ex[f.key];
  const req = f.required ? ' <span class="req">*</span>' : '';
  const key = esc(f.key);
  const opts = f.options || [];
  let control;
  switch (f.type) {
    case 'textarea':
      control = `<textarea data-ckey="${key}">${esc(v || '')}</textarea>`; break;
    case 'number':
      control = `<input type="number" data-ckey="${key}" value="${esc(v || '')}" />`; break;
    case 'date':
      control = `<input type="date" data-ckey="${key}" value="${esc(v || '')}" />`; break;
    case 'select':
      control = `<select data-ckey="${key}"><option value="">—</option>${opts.map((o) => `<option value="${esc(o)}" ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`; break;
    case 'radio':
      control = `<div class="opt-group">${opts.map((o) => `<label class="opt"><input type="radio" name="ck_${key}" data-ckeyradio="${key}" value="${esc(o)}" ${o === v ? 'checked' : ''} /> ${esc(o)}</label>`).join('')}</div>`; break;
    case 'boolean':
      control = `<div class="opt-group">
        <label class="opt"><input type="radio" name="ck_${key}" data-ckeyradio="${key}" value="Sim" ${v === 'Sim' ? 'checked' : ''} /> Sim</label>
        <label class="opt"><input type="radio" name="ck_${key}" data-ckeyradio="${key}" value="Não" ${v === 'Não' ? 'checked' : ''} /> Não</label>
      </div>`; break;
    case 'checkbox': {
      const arr = Array.isArray(v) ? v : [];
      control = `<div class="opt-group">${opts.map((o) => `<label class="opt"><input type="checkbox" data-ckeymulti="${key}" value="${esc(o)}" ${arr.includes(o) ? 'checked' : ''} /> ${esc(o)}</label>`).join('')}</div>`; break;
    }
    default:
      control = `<input type="text" data-ckey="${key}" value="${esc(v || '')}" />`;
  }
  return `<div class="field" style="text-align:left"><label>${esc(f.label)}${req}</label>${control}</div>`;
}
function customFieldsHtml(extraRaw) {
  const ex = parseExtra(extraRaw);
  const fields = eventCustomFields();
  if (!fields.length) return '';
  return fields.map((f) => customFieldControl(f, ex)).join('');
}
function collectCustom() {
  const out = {};
  eventCustomFields().forEach((f) => {
    if (f.type === 'checkbox') {
      out[f.key] = [...document.querySelectorAll(`.modal [data-ckeymulti="${CSS.escape(f.key)}"]:checked`)].map((x) => x.value);
    } else if (f.type === 'radio' || f.type === 'boolean') {
      const el = document.querySelector(`.modal [data-ckeyradio="${CSS.escape(f.key)}"]:checked`);
      out[f.key] = el ? el.value : '';
    } else {
      const el = document.querySelector(`.modal [data-ckey="${CSS.escape(f.key)}"]`);
      out[f.key] = el ? el.value.trim() : '';
    }
  });
  return out;
}
// Campo de observações internas (uso administrativo) para os modais.
function notesField(id, value) {
  return `<div class="field" style="text-align:left">
    <label>Observações internas <span class="muted" style="font-weight:400">(só admin)</span></label>
    <textarea id="${id}" rows="2" placeholder="Ex.: levar acompanhante, mesa próxima ao palco, confirmado por telefone…">${esc(value || '')}</textarea>
  </div>`;
}

function editParticipant(pid) {
  const p = LAST_LIST.find((x) => x.id === pid);
  if (!p) return;
  const yes = p.response === 'confirmado';
  modal(`
    <h3 style="font-size:17px;margin-bottom:4px">Editar participante</h3>
    <p class="muted" style="font-size:13px;margin:0 0 16px">As alterações ficam registradas no histórico.</p>
    ${fieldRow('ed_name', 'Nome completo', p.name)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      ${fieldRow('ed_company', 'Empresa', p.company)}
      ${fieldRow('ed_role', 'Cargo', p.role)}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      ${fieldRow('ed_email', 'E-mail', p.email, 'email')}
      ${fieldRow('ed_phone', 'Telefone', p.phone)}
    </div>
    ${customFieldsHtml(p.extra)}
    <div class="field" style="text-align:left">
      <label>Presença</label>
      <div class="edit-presence">
        <label class="ep ep-yes ${yes ? 'on' : ''}"><input type="radio" name="ed_resp" value="confirmado" ${yes ? 'checked' : ''}/> Confirmado</label>
        <label class="ep ep-no ${!yes ? 'on' : ''}"><input type="radio" name="ed_resp" value="recusado" ${!yes ? 'checked' : ''}/> Recusado</label>
      </div>
    </div>
    ${notesField('ed_notes', p.notes)}
    <p class="error-msg hidden" id="ed_err" style="text-align:left"></p>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px">
      <button class="btn btn-ghost btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" onclick="saveParticipant(${pid})">Salvar alterações</button>
    </div>`);
  document.querySelectorAll('.edit-presence .ep').forEach((lab) => {
    lab.addEventListener('click', () => {
      document.querySelectorAll('.edit-presence .ep').forEach((x) => x.classList.remove('on'));
      lab.classList.add('on');
    });
  });
}

async function saveParticipant(pid) {
  const val = (id) => document.getElementById(id).value.trim();
  const err = document.getElementById('ed_err');
  if (!val('ed_name')) { err.textContent = 'O nome é obrigatório.'; err.classList.remove('hidden'); return; }
  const prev = LAST_LIST.find((x) => x.id === pid);
  const oldResp = prev ? prev.response : null;
  const newResp = document.querySelector('input[name="ed_resp"]:checked').value;
  const payload = {
    name: val('ed_name'), company: val('ed_company'), role: val('ed_role'),
    email: val('ed_email'), phone: val('ed_phone'), response: newResp, extra: collectCustom(),
    notes: document.getElementById('ed_notes').value,
  };
  try {
    await Api.put(`/api/events/${ID}/participants/${pid}`, payload);
    closeModal();
    await loadParticipants();
    // Se o status mudou, oferece desfazer.
    if (oldResp && oldResp !== newResp) {
      showUndo('Status alterado.', async () => {
        try { await Api.put(`/api/events/${ID}/participants/${pid}`, { response: oldResp }); loadParticipants(); } catch (e) { toast(e.message); }
      });
    } else {
      toast('Participante atualizado.');
    }
  } catch (e) {
    err.textContent = e.message; err.classList.remove('hidden');
  }
}

async function showAudit(pid) {
  const p = LAST_LIST.find((x) => x.id === pid);
  const name = p ? p.name : '';
  const log = await Api.get(`/api/events/${ID}/participants/${pid}/audit`);
  const lines = log.map((a) => `
    <div class="audit-line"><span class="d">${fmtDateTimeBR(a.created_at)}</span>${a.actor ? ' · <strong>' + esc(a.actor) + '</strong>' : ''} — ${esc(a.details || a.action)}</div>`).join('') || '<p class="muted">Sem registros.</p>';
  modal(`
    <h3 style="font-size:17px;margin-bottom:4px">Histórico de alterações</h3>
    <p class="muted" style="font-size:13px;margin:0 0 14px">${esc(name)}</p>
    <div style="text-align:left">${lines}</div>
    <button class="btn btn-ghost btn-sm" style="margin-top:18px" onclick="closeModal()">Fechar</button>`);
}

// ---- Seleção múltipla e ações em massa ----
function syncSelectionUI() {
  // remove da seleção ids que não estão mais visíveis
  const visible = new Set(LAST_LIST.map((p) => p.id));
  for (const id of [...SELECTED]) if (!visible.has(id)) SELECTED.delete(id);
  const bar = document.getElementById('bulkBar');
  const all = document.getElementById('checkAll');
  if (all) all.checked = LAST_LIST.length > 0 && LAST_LIST.every((p) => SELECTED.has(p.id));
  if (!SELECTED.size) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
  bar.classList.remove('hidden');
  // Resumo dos selecionados por status (reduz erros em ações em massa).
  const sel = LAST_LIST.filter((p) => SELECTED.has(p.id));
  const nConf = sel.filter((p) => p.response === 'confirmado').length;
  const nRec = sel.filter((p) => p.response === 'recusado').length;
  const allSelected = LAST_LIST.length > 0 && SELECTED.size >= LAST_LIST.length;

  const actions = [];
  if (can('can_participants')) {
    actions.push('<button class="btn btn-sm bulk-confirm" onclick="bulkAction(\'confirmar\')">Marcar Confirmado</button>');
    actions.push('<button class="btn btn-sm bulk-decline" onclick="bulkAction(\'recusar\')">Marcar Recusado</button>');
  }
  if (can('can_export')) actions.push('<button class="btn btn-sm btn-ghost" onclick="bulkExport()">Exportar selecionados</button>');
  if (can('can_participants')) actions.push('<button class="btn btn-sm bulk-delete" onclick="bulkAction(\'excluir\')">Excluir</button>');
  if (can('can_messages')) actions.push('<button class="btn btn-sm btn-ghost" disabled title="Em breve">WhatsApp (em breve)</button>');
  actions.push('<button class="btn btn-sm btn-ghost" onclick="clearSelection()">Cancelar seleção</button>');

  // "Selecionar todos os N resultados" do filtro atual (quando ainda não estão todos).
  const selectAllLine = (!allSelected && LAST_LIST.length > SELECTED.size)
    ? `<button type="button" class="bulk-selectall" onclick="selectAllFiltered()">Selecionar todos os ${LAST_LIST.length} resultados</button>`
    : '';

  bar.innerHTML = `
    <div class="bulk-summary">
      <span class="bulk-count">Selecionados: <strong>${SELECTED.size}</strong> participante(s)</span>
      <span class="bulk-breakdown">${nConf} confirmado(s) · ${nRec} recusado(s)</span>
      ${selectAllLine}
    </div>
    <div class="bulk-actions">${actions.join('')}</div>`;
}
function clearSelection() { SELECTED.clear(); document.querySelectorAll('.row-check').forEach((c) => { c.checked = false; }); syncSelectionUI(); }
// Seleciona todos os resultados do filtro atual (a lista já vem completa do backend).
function selectAllFiltered() {
  LAST_LIST.forEach((p) => SELECTED.add(p.id));
  document.querySelectorAll('.row-check').forEach((c) => { c.checked = true; });
  syncSelectionUI();
}

document.getElementById('rows').addEventListener('change', (e) => {
  const cb = e.target.closest('.row-check'); if (!cb) return;
  const id = Number(cb.value);
  if (cb.checked) SELECTED.add(id); else SELECTED.delete(id);
  syncSelectionUI();
});
document.getElementById('checkAll').addEventListener('change', (e) => {
  if (e.target.checked) LAST_LIST.forEach((p) => SELECTED.add(p.id));
  else LAST_LIST.forEach((p) => SELECTED.delete(p.id));
  document.querySelectorAll('.row-check').forEach((c) => { c.checked = SELECTED.has(Number(c.value)); });
  syncSelectionUI();
});

async function bulkAction(action) {
  const ids = [...SELECTED];
  if (!ids.length) return;
  if (action === 'excluir') {
    if (!confirm(`Tem certeza que deseja excluir ${ids.length} participante(s)? Esta ação não poderá ser desfeita.`)) return;
  } else {
    const labels = { confirmar: 'marcar como Confirmado', recusar: 'marcar como Recusado' };
    if (!confirm(`Deseja ${labels[action]} ${ids.length} participante(s)?`)) return;
  }
  try {
    const r = await Api.post(`/api/events/${ID}/participants/mass`, { action, ids });
    toast(`${r.affected} participante(s) atualizados.`);
    SELECTED.clear();
    await loadParticipants();
  } catch (e) { toast(e.message); }
}
function bulkExport() {
  const ids = [...SELECTED].join(',');
  if (!ids) return;
  downloadSelected('xlsx', ids);
}
async function downloadSelected(format, ids) {
  const res = await fetch(`/api/events/${ID}/participants/export?format=${format}&ids=${ids}`, { headers: { Authorization: `Bearer ${Api.token()}` } });
  if (!res.ok) return toast('Erro ao exportar.');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `rsvp-${EVENT.slug}-selecionados.${format}`;
  a.click(); URL.revokeObjectURL(a.href);
}

function modal(html) { document.getElementById('modalSlot').innerHTML = `<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal">${html}</div></div>`; }
function closeModal() { document.getElementById('modalSlot').innerHTML = ''; }

// ---- Toast com ação "Desfazer" ----
function showUndo(message, onUndo) {
  let el = document.querySelector('.undo-toast');
  if (el) el.remove();
  el = document.createElement('div');
  el.className = 'undo-toast';
  el.innerHTML = `<span>${esc(message)}</span><button>Desfazer</button>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const hide = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); };
  el.querySelector('button').addEventListener('click', () => { onUndo(); hide(); });
  el._t = setTimeout(hide, 5000);
}

// ---- Excluir participante com desfazer (a remoção só efetiva após 5s) ----
function deleteParticipant(pid) {
  const p = LAST_LIST.find((x) => x.id === pid);
  if (!p) return;
  let undone = false;
  LAST_LIST = LAST_LIST.filter((x) => x.id !== pid);
  renderRows(LAST_LIST);
  const timer = setTimeout(async () => {
    if (undone) return;
    try { await Api.del(`/api/events/${ID}/participants/${pid}`); } catch (e) { toast(e.message); }
    loadParticipants();
  }, 5000);
  showUndo(`${p.name} removido.`, () => { undone = true; clearTimeout(timer); loadParticipants(); });
}

// ---- Duplicar evento ----
document.getElementById('dupBtn').addEventListener('click', async () => {
  if (!confirm('Duplicar este evento? Será criada uma cópia com as mesmas configurações, sem os participantes.')) return;
  try { const novo = await Api.post(`/api/events/${ID}/duplicate`); toast('Evento duplicado.'); location.href = `/admin/event-form.html?id=${novo.id}`; }
  catch (e) { toast(e.message); }
});

function exportUrl(format) {
  const p = new URLSearchParams({ format });
  if (state.filter) p.set('filter', state.filter);
  if (state.q) p.set('q', state.q);
  return `/api/events/${ID}/participants/export?${p}`;
}
const EXT = { csv: 'csv', xlsx: 'xlsx', pdf: 'pdf' };
async function download(format) {
  const res = await fetch(exportUrl(format), { headers: { Authorization: `Bearer ${Api.token()}` } });
  if (!res.ok) return toast('Erro ao exportar.');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `rsvp-${EVENT.slug}.${EXT[format] || format}`;
  a.click(); URL.revokeObjectURL(a.href);
}

// Baixa o QR Code no formato pedido (autenticado).
async function downloadQr(format) {
  toast('Gerando QR Code…');
  const res = await fetch(`/api/events/${ID}/qrcode?format=${format}`, { headers: { Authorization: `Bearer ${Api.token()}` } });
  if (!res.ok) return toast('Erro ao gerar o QR Code.');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `qrcode-${EVENT.slug}.${format}`;
  a.click(); URL.revokeObjectURL(a.href);
}

// ---- Copiar link e abrir QR (chamados pelos botões do resumo) ----
async function copyLink() {
  try { await navigator.clipboard.writeText(EVENT.public_url); toast('Link copiado.'); }
  catch { toast('Copie manualmente: ' + EVENT.public_url); }
}
function openQr() {
  modal(`<h3 style="font-size:17px">QR Code do evento</h3>
    <img id="qrPreview" alt="QR Code" style="background:#fff;border:1px solid var(--gray-soft);border-radius:10px" />
    <p class="muted" style="font-size:12px;margin:0 0 14px">Preto e branco. Aponte a câmera para abrir o link de confirmação.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <button class="btn btn-primary btn-sm" onclick="downloadQr('png')">Baixar PNG</button>
      <button class="btn btn-ghost btn-sm" onclick="downloadQr('jpg')">Baixar JPG</button>
      <button class="btn btn-ghost btn-sm" onclick="downloadQr('svg')">Baixar SVG</button>
      <button class="btn btn-ghost btn-sm" onclick="downloadQr('pdf')">Baixar PDF</button>
    </div>
    <button class="btn btn-ghost btn-sm" style="margin-top:12px;width:100%" onclick="closeModal()">Fechar</button>`);
  fetchQrPreview();
}
async function fetchQrPreview() {
  const res = await fetch(`/api/events/${ID}/qrcode?format=png`, { headers: { Authorization: `Bearer ${Api.token()}` } });
  const blob = await res.blob();
  const img = document.getElementById('qrPreview');
  if (img) img.src = URL.createObjectURL(blob);
}
document.getElementById('seg').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  document.querySelectorAll('#seg button').forEach((x) => x.classList.remove('active'));
  b.classList.add('active'); state.filter = b.dataset.f; loadParticipants();
});
let searchT;
document.getElementById('search').addEventListener('input', (e) => {
  clearTimeout(searchT); searchT = setTimeout(() => { state.q = e.target.value; loadParticipants(); }, 250);
});
document.getElementById('csvBtn').addEventListener('click', () => download('csv'));
document.getElementById('xlsxBtn').addEventListener('click', () => download('xlsx'));
document.getElementById('pdfBtn').addEventListener('click', () => download('pdf'));
document.getElementById('addOneBtn').addEventListener('click', addOne);
document.getElementById('addBulkBtn').addEventListener('click', addBulk);

// ---- Inclusão manual e em lote ----
function addOne() {
  modal(`
    <h3 style="font-size:17px;margin-bottom:4px">Adicionar participante</h3>
    <p class="muted" style="font-size:13px;margin:0 0 16px">Inclua manualmente uma pessoa já confirmada.</p>
    ${fieldRow('ao_name', 'Nome completo', '')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      ${fieldRow('ao_company', 'Empresa', '')}
      ${fieldRow('ao_role', 'Cargo', '')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      ${fieldRow('ao_email', 'E-mail', '', 'email')}
      ${fieldRow('ao_phone', 'Telefone', '')}
    </div>
    ${customFieldsHtml(null)}
    <div class="field" style="text-align:left">
      <label>Presença</label>
      <div class="edit-presence">
        <label class="ep ep-yes on"><input type="radio" name="ao_resp" value="confirmado" checked/> Confirmado</label>
        <label class="ep ep-no"><input type="radio" name="ao_resp" value="recusado"/> Recusado</label>
      </div>
    </div>
    ${notesField('ao_notes', '')}
    <p class="error-msg hidden" id="ao_err" style="text-align:left"></p>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px">
      <button class="btn btn-ghost btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" onclick="saveOne()">Adicionar</button>
    </div>`);
  document.querySelectorAll('.edit-presence .ep').forEach((lab) => {
    lab.addEventListener('click', () => {
      document.querySelectorAll('.edit-presence .ep').forEach((x) => x.classList.remove('on'));
      lab.classList.add('on');
    });
  });
  document.getElementById('ao_name').focus();
}
async function saveOne(force) {
  const v = (id) => document.getElementById(id).value.trim();
  const err = document.getElementById('ao_err');
  if (!v('ao_name')) { err.textContent = 'Informe o nome.'; err.classList.remove('hidden'); return; }
  const payload = {
    name: v('ao_name'), company: v('ao_company'), role: v('ao_role'),
    email: v('ao_email'), phone: v('ao_phone'),
    response: document.querySelector('input[name="ao_resp"]:checked').value,
    extra: collectCustom(), notes: document.getElementById('ao_notes').value,
  };
  if (force) payload.force_update = true;
  try {
    const r = await Api.post(`/api/events/${ID}/participants`, payload);
    closeModal();
    toast(r.updated ? 'Cadastro atualizado.' : 'Participante adicionado.');
    loadParticipants();
    renderMesaMap().catch(() => {});
  } catch (e) {
    // Possível duplicado: o backend devolve 409 com a mensagem; oferecemos atualizar.
    if (/já existe/i.test(e.message)) {
      if (confirm(e.message)) { saveOne(true); return; }
      return;
    }
    err.textContent = e.message; err.classList.remove('hidden');
  }
}

function addBulk() {
  modal(`
    <h3 style="font-size:17px;margin-bottom:4px">Incluir em lote</h3>
    <p class="muted" style="font-size:13px;margin:0 0 14px;text-align:left">Cole um nome por linha. Opcional, separando por vírgula: <em>Nome, e-mail, empresa, cargo, telefone</em>. Nomes já existentes são ignorados.</p>
    <div class="field" style="text-align:left">
      <textarea id="bulk_text" rows="8" placeholder="Maria Silva, maria@email.com&#10;João Souza&#10;Ana Lima, ana@email.com, ACME, Diretora"></textarea>
    </div>
    <div class="field" style="text-align:left">
      <label>Marcar todos como</label>
      <div class="edit-presence">
        <label class="ep ep-yes on"><input type="radio" name="bulk_resp" value="confirmado" checked/> Confirmado</label>
        <label class="ep ep-no"><input type="radio" name="bulk_resp" value="recusado"/> Recusado</label>
      </div>
    </div>
    <p class="error-msg hidden" id="bulk_err" style="text-align:left"></p>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:6px">
      <button class="btn btn-ghost btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" onclick="saveBulk()">Incluir lista</button>
    </div>`);
  document.querySelectorAll('.edit-presence .ep').forEach((lab) => {
    lab.addEventListener('click', () => {
      document.querySelectorAll('.edit-presence .ep').forEach((x) => x.classList.remove('on'));
      lab.classList.add('on');
    });
  });
}
async function saveBulk() {
  const text = document.getElementById('bulk_text').value;
  const err = document.getElementById('bulk_err');
  if (!text.trim()) { err.textContent = 'Cole ao menos um nome.'; err.classList.remove('hidden'); return; }
  const response = document.querySelector('input[name="bulk_resp"]:checked').value;
  try {
    const r = await Api.post(`/api/events/${ID}/participants/bulk`, { text, response });
    closeModal();
    toast(`${r.added} incluído(s)${r.skipped_count ? `, ${r.skipped_count} já existia(m)` : ''}.`);
    loadParticipants();
    renderMesaMap().catch(() => {});
  } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
}

// Leva o cursor para a busca rápida de participantes (sem rolar a página).
function focusSearch() {
  const el = document.getElementById('search');
  if (el && !('ontouchstart' in window)) el.focus({ preventScroll: true });
}

// ════════════════════════════════════════════════════════════════════════════
//  MAPA VISUAL DE MESAS
//  Visão gráfica (em vez de só lista): cada mesa vira um cartão colorido pela
//  ocupação. 🟢 livre · 🟡 próximo do limite · 🔴 excedente (overbooking).
// ════════════════════════════════════════════════════════════════════════════

let MESA_PARTS = [];  // convidados (cache p/ o detalhe de cada mesa)
let MESA_TABLES = []; // mesas configuradas (cache p/ o detalhe de cada mesa)

// Classifica a mesa pela ocupação para escolher a cor.
function mesaTone(allocated, capacity) {
  if (!capacity || capacity <= 0) return 'na';        // sem capacidade definida
  if (allocated > capacity) return 'over';            // 🔴 excedente
  if (allocated >= Math.max(1, Math.ceil(capacity * 0.85))) return 'near'; // 🟡 próximo do limite / cheio
  return 'free';                                       // 🟢 livre
}

// Agrupa convidados confirmados por nome de mesa (igual ao app de check-in).
function mesaAssigned(parts) {
  const m = {};
  parts.forEach((p) => {
    if (p.response !== 'confirmado') return;
    const t = String(p.table_number || '').trim();
    if (!t) return;
    m[t] = m[t] || { allocated: 0, present: 0 };
    m[t].allocated++;
    if (p.checked_in_at) m[t].present++;
  });
  return m;
}

async function renderMesaMap() {
  const wrap = document.getElementById('mesaMap');
  if (!wrap) return;
  // Só faz sentido em eventos marcados como "com mesas".
  if (!EVENT || !EVENT.has_tables) { wrap.classList.add('hidden'); wrap.innerHTML = ''; return; }
  wrap.classList.remove('hidden');

  let tables = [];
  try {
    // Mesas configuradas (nome + capacidade). A mesma API usada no check-in.
    tables = await Api.get(`/api/checkin/events/${ID}/tables`);
    MESA_TABLES = tables;
    // Convidados (para o detalhe por mesa e para detectar mesas "extras").
    const data = await Api.get(`/api/events/${ID}/participants`);
    MESA_PARTS = data.participants || [];
  } catch (e) {
    wrap.innerHTML = `<div class="card"><div class="mesa-map-head"><h2>Mapa de mesas</h2></div><p class="muted" style="margin:0">Não foi possível carregar as mesas: ${esc(e.message)}</p></div>`;
    return;
  }

  const assigned = mesaAssigned(MESA_PARTS);
  const confNames = new Set(tables.map((t) => String(t.name)));
  // Mesas digitadas nos convidados que não estão na configuração (capacidade desconhecida).
  const extras = Object.keys(assigned)
    .filter((n) => !confNames.has(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((n) => ({ name: n, capacity: 0, extra: true, allocated: assigned[n].allocated, present: assigned[n].present }));

  const all = tables
    .slice()
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map((t) => ({ ...t, allocated: assigned[t.name] ? assigned[t.name].allocated : (t.allocated || 0), present: assigned[t.name] ? assigned[t.name].present : (t.present || 0) }))
    .concat(extras);

  if (!all.length) {
    wrap.innerHTML = `
      <div class="card">
        <div class="mesa-map-head"><h2>Mapa de mesas</h2>
          <button class="btn btn-ghost btn-sm" onclick="renderMesaMap()">Atualizar</button></div>
        <p class="muted" style="margin:0">Nenhuma mesa configurada ainda. Configure as mesas no aplicativo de check-in (botão ⚙ Configurar mesas) para ver o mapa colorido aqui.</p>
      </div>`;
    return;
  }

  const totalCap = tables.reduce((s, t) => s + (t.capacity || 0), 0);
  const totalAlloc = all.reduce((s, t) => s + (t.allocated || 0), 0);
  const overCount = all.filter((t) => t.capacity > 0 && t.allocated > t.capacity).length;

  const cards = all.map((t) => {
    const cap = t.capacity || 0;
    const a = t.allocated || 0;
    const p = t.present || 0;
    const tone = t.extra ? 'na' : mesaTone(a, cap);
    const isOver = cap > 0 && a > cap;
    let seats = '';
    if (cap > 0) {
      const shown = Math.min(cap, 24);
      for (let i = 0; i < shown; i++) seats += `<span class="mseat ${i < a ? 'occ' : 'free'}"></span>`;
      if (isOver) { const ov = Math.min(a - cap, 10); for (let i = 0; i < ov; i++) seats += '<span class="mseat over"></span>'; }
      if (cap > 24) seats += `<span class="mseat-more">+${cap - 24}</span>`;
    }
    const label = t.name === 'Sem mesa' ? 'Sem mesa' : `Mesa ${esc(t.name)}`;
    return `<button class="mesa-card tone-${tone}" onclick="mesaDetail('${esc(String(t.name)).replace(/'/g, '')}')">
      <div class="mc-top"><span class="mc-name">${label}</span>${isOver ? '<span class="mc-flag">EXCEDE</span>' : ''}</div>
      <div class="mc-count ${isOver ? 'over' : ''}">${a}${cap > 0 ? `<span>/${cap}</span>` : '<span> aloc.</span>'}</div>
      ${cap > 0 ? `<div class="mc-seats">${seats}</div>` : '<div class="mc-na">capacidade não definida</div>'}
      <div class="mc-foot">${p} presente${p !== 1 ? 's' : ''}</div>
    </button>`;
  }).join('');

  wrap.innerHTML = `
    <div class="card">
      <div class="mesa-map-head">
        <h2>Mapa de mesas</h2>
        <div class="mesa-kpis">
          <span class="mk"><b>${tables.length}</b> mesa${tables.length !== 1 ? 's' : ''}</span>
          ${totalCap ? `<span class="mk"><b>${totalAlloc}/${totalCap}</b> lugares</span>` : ''}
          ${overCount ? `<span class="mk over"><b>${overCount}</b> excedente${overCount !== 1 ? 's' : ''}</span>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="renderMesaMap()">Atualizar</button>
        </div>
      </div>
      ${overCount ? `<div class="mesa-warn">⚠ ${overCount} mesa${overCount !== 1 ? 's' : ''} com mais convidados do que lugares.</div>` : ''}
      <div class="mesa-legend">
        <span><span class="lg free"></span> Livre</span>
        <span><span class="lg near"></span> Próximo do limite</span>
        <span><span class="lg over"></span> Excedente</span>
      </div>
      <div class="mesa-grid">${cards}</div>
    </div>`;
}

// Abre o detalhe de uma mesa: quem está alocado e quem já fez check-in.
function mesaDetail(name) {
  const arr = MESA_PARTS
    .filter((p) => p.response === 'confirmado' && (String(p.table_number || '').trim() || 'Sem mesa') === name)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const total = arr.length;
  const present = arr.filter((p) => p.checked_in_at).length;
  const conf = MESA_TABLES.find((t) => String(t.name) === name);
  const cap = conf ? conf.capacity : 0;
  const isOver = cap > 0 && total > cap;
  const list = arr.map((p) => `
    <div class="mesa-guest ${p.checked_in_at ? 'present' : ''}">
      <span class="mg-name">${esc(p.name)}${p.company ? `<span class="mg-co"> · ${esc(p.company)}</span>` : ''}</span>
      <span class="mg-tag">${p.checked_in_at ? '✓ Presente' : 'Ausente'}</span>
    </div>`).join('');
  modal(`
    <h3 style="font-size:18px;margin:0 0 4px">${name === 'Sem mesa' ? 'Sem mesa' : 'Mesa ' + esc(name)}</h3>
    <p class="muted" style="margin:0 0 14px;font-size:13.5px">${total} alocado${total !== 1 ? 's' : ''}${cap > 0 ? ' de ' + cap + ' lugares' : ''} · ${present} presente${present !== 1 ? 's' : ''}${isOver ? ' · ⚠ excedente' : ''}</p>
    <div class="mesa-guest-list">${list || '<p class="muted" style="margin:0">Nenhum convidado nesta mesa.</p>'}</div>
    <div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="btn btn-ghost btn-sm" onclick="closeModal()">Fechar</button></div>`);
}

(async () => {
  await loadEvent();
  await loadParticipants();
  renderMesaMap().catch(() => {});
  focusSearch();
})().catch((e) => toast(e.message));
document.getElementById('refreshSlot').appendChild(refreshButton(async () => { await loadParticipants(); focusSearch(); }, 'Atualizar lista'));
