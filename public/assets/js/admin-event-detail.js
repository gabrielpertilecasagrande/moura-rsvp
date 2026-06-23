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
  // Selo de origem (Moura One) + código de referência curto (logs/rastreio).
  const eyebrow = document.getElementById('eyebrow');
  if (eyebrow) {
    eyebrow.innerHTML = `Evento${EVENT.source_event_id ? ' <span class="origin-selo">◆ Moura One</span>' : ''}${EVENT.ref_code ? ` <span class="origin-ref">${esc(EVENT.ref_code)}</span>` : ''}`;
  }
  document.getElementById('evMeta').textContent =
    `${EVENT.event_date ? fmtDateBR(EVENT.event_date) : 'Data a definir'}${EVENT.event_time ? ' · ' + EVENT.event_time : ''}${EVENT.location ? ' · ' + EVENT.location : ''}`;
  document.getElementById('openPublic').href = EVENT.public_url;
  document.getElementById('editBtn').href = `/admin/event-form.html?id=${ID}`;
  applyPermissions();
  renderReopenBanner();
  setupQuickLinks();
}

// Atalhos de navegação entre plataformas (Moura One ↩ e Check-in 📱).
// As URLs vêm de /api/public/app-config (definidas por variável de ambiente).
async function setupQuickLinks() {
  let cfg = {};
  try { cfg = await Api.get('/api/public/app-config'); } catch { /* sem config → atalhos ocultos */ }
  const moBtn = document.getElementById('mouraOneBtn');
  if (moBtn && cfg.moura_one_url && EVENT.source_event_id) {
    moBtn.href = `${cfg.moura_one_url}/admin/event-detail.html?id=${encodeURIComponent(EVENT.source_event_id)}`;
    moBtn.style.display = '';
  }
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
  // Só faz sentido mostrar o índice quando há convidados esperados definidos como base.
  const hasBase = EVENT && Number(EVENT.expected_guests) > 0;
  const rateDisplay = hasBase ? (adesao + '%') : '—';
  const rateTip = hasBase
    ? 'Proporção de quem confirmou entre todos que responderam. Ex.: 62 confirmados de 65 respostas = 95%.'
    : 'Defina a quantidade de "Convidados esperados" no evento para calcular este índice.';
  const defs = [
    { n: s.total, l: 'Respostas', tone: 'navy', ico: STAT_ICONS.respostas },
    { n: s.confirmed, l: 'Confirmados', tone: 'green', ico: STAT_ICONS.check },
    { n: s.declined, l: 'Recusas', tone: s.declined > 0 ? 'red' : 'gray', ico: STAT_ICONS.x },
    { n: rateDisplay, l: 'Índice de adesão', tone: hasBase ? rateTone(adesao) : 'gray', ico: STAT_ICONS.rate, tip: rateTip },
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

function auditActionLabel(action) {
  const labels = { criou: 'Adicionado', editou: 'Editado', excluiu: 'Removido', enviou: 'Mensagem enviada' };
  return labels[action] || action;
}
function auditBrowserShort(ua) {
  if (!ua) return '';
  if (/iPhone|iPad/i.test(ua)) return 'iPhone/iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Chrome/i.test(ua)) return 'Chrome';
  if (/Safari/i.test(ua)) return 'Safari';
  if (/Firefox/i.test(ua)) return 'Firefox';
  if (/Edge/i.test(ua)) return 'Edge';
  return ua.slice(0, 40);
}

async function showAudit(pid) {
  const p = LAST_LIST.find((x) => x.id === pid);
  const name = p ? p.name : '';
  const log = await Api.get(`/api/events/${ID}/participants/${pid}/audit`);
  const lines = log.map((a) => {
    const meta = [];
    if (a.ip) meta.push(`IP: ${esc(a.ip)}`);
    if (a.user_agent) meta.push(`Navegador: ${esc(auditBrowserShort(a.user_agent))}`);
    if (a.origin) meta.push(a.origin === 'admin' ? 'Painel admin' : a.origin === 'formulario' ? 'Formulário público' : esc(a.origin));
    return `
    <div class="audit-line">
      <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">
        <span class="d">${fmtDateTimeBR(a.created_at)}</span>
        ${a.actor ? '<strong>' + esc(a.actor) + '</strong>' : ''}
        <span class="audit-action-tag audit-action-${esc(a.action)}">${auditActionLabel(a.action)}</span>
      </div>
      <div style="margin:2px 0 0 0;font-size:13px">${esc(a.details || '')}</div>
      ${meta.length ? `<div class="audit-meta">${meta.join(' · ')}</div>` : ''}
    </div>`;
  }).join('') || '<p class="muted">Sem registros.</p>';
  modal(`
    <h3 style="font-size:17px;margin-bottom:4px">Histórico — ${esc(name)}</h3>
    <p class="muted" style="font-size:12px;margin:0 0 14px">Registro de todas as ações realizadas neste convidado.</p>
    <div style="text-align:left;max-height:420px;overflow-y:auto">${lines}</div>
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
  if (can('can_messages')) actions.push('<button class="btn btn-sm btn-wa-bulk" onclick="bulkWhatsapp()"><img src="/assets/img/whatsapp.png" width="14" height="14" style="display:block;flex-shrink:0" alt="" /> WhatsApp</button>');
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

// ---- Excluir participante ----
async function deleteParticipant(pid) {
  const p = LAST_LIST.find((x) => x.id === pid);
  if (!p) return;
  if (!confirm(`Remover "${p.name}"? Esta ação não pode ser desfeita.`)) return;
  try {
    await Api.del(`/api/events/${ID}/participants/${pid}`);
    toast(`${p.name} removido.`);
    loadParticipants();
  } catch (e) { toast(e.message); }
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
    <p class="muted" style="font-size:13px;margin:0 0 14px;text-align:left">Importe uma planilha <strong>Excel ou CSV</strong> ou cole os nomes diretamente. Colunas esperadas: <em>Nome, E-mail, Empresa, Cargo, Telefone</em>. Nomes já existentes são ignorados.</p>
    <div class="field" style="text-align:left">
      <label>Importar planilha (Excel .xlsx ou CSV)</label>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <label class="btn btn-ghost btn-sm" style="cursor:pointer;margin:0;display:inline-flex;align-items:center;gap:6px">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Selecionar arquivo
          <input type="file" id="bulk_file" accept=".xlsx,.xls,.csv" style="display:none" onchange="parsePlanilha(this)" />
        </label>
        <span id="bulk_file_name" class="muted" style="font-size:13px">Nenhum arquivo selecionado</span>
      </div>
    </div>
    <div class="field" style="text-align:left">
      <label>Ou cole a lista diretamente (um por linha)</label>
      <textarea id="bulk_text" rows="7" placeholder="Maria Silva, maria@email.com&#10;João Souza&#10;Ana Lima, ana@email.com, ACME, Diretora"></textarea>
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

function parsePlanilha(input) {
  const file = input.files[0];
  if (!file) return;
  document.getElementById('bulk_file_name').textContent = file.name;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      // Detecta linha de cabeçalho (primeira célula com label comum) e pula.
      let startRow = 0;
      if (rows.length > 0) {
        const first = String(rows[0][0] || '').toLowerCase().trim();
        if (['nome', 'name', 'participante', 'convidado'].includes(first)) startRow = 1;
      }
      const lines = rows.slice(startRow)
        .filter((r) => r.some((c) => String(c).trim()))
        .map((r) => r.map((c) => String(c).trim()).filter((_, i) => i < 5).join(', '));
      const textarea = document.getElementById('bulk_text');
      textarea.value = lines.join('\n');
      const err = document.getElementById('bulk_err');
      err.classList.add('hidden');
    } catch {
      const err = document.getElementById('bulk_err');
      err.textContent = 'Não foi possível ler o arquivo. Verifique se é um Excel ou CSV válido.';
      err.classList.remove('hidden');
    }
  };
  reader.readAsArrayBuffer(file);
}

async function saveBulk() {
  const text = document.getElementById('bulk_text').value;
  const err = document.getElementById('bulk_err');
  if (!text.trim()) { err.textContent = 'Cole ao menos um nome ou selecione uma planilha.'; err.classList.remove('hidden'); return; }
  const response = document.querySelector('input[name="bulk_resp"]:checked').value;
  try {
    const r = await Api.post(`/api/events/${ID}/participants/bulk`, { text, response });
    closeModal();
    toast(`${r.added} incluído(s)${r.skipped_count ? `, ${r.skipped_count} já existia(m)` : ''}.`);
    loadParticipants();
  } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
}

// ---- WhatsApp coletivo ----
let WA_SESSION = null;

function bulkWhatsapp() {
  const sel = LAST_LIST.filter((p) => SELECTED.has(p.id) && guestWa(p.phone));
  if (!sel.length) {
    toast('Nenhum participante selecionado tem telefone cadastrado.');
    return;
  }
  WA_SESSION = { sel, tpl: '', idx: 0 };
  const sem = SELECTED.size > sel.length ? `<p class="muted" style="font-size:12px;margin:0 0 12px">${SELECTED.size - sel.length} participante(s) sem telefone serão ignorados.</p>` : '';
  modal(`
    <h3 style="font-size:17px;margin-bottom:4px">WhatsApp em massa</h3>
    <p class="muted" style="font-size:13px;margin:0 0 4px">${sel.length} participante(s) com telefone cadastrado</p>
    ${sem}
    <div class="field" style="text-align:left">
      <label>Mensagem — clique nas variáveis para inserir</label>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
        <button type="button" class="btn btn-ghost btn-sm" style="font-size:12px" onclick="insertWaVar('{nome}')">+ {nome}</button>
        <button type="button" class="btn btn-ghost btn-sm" style="font-size:12px" onclick="insertWaVar('{empresa}')">+ {empresa}</button>
        <button type="button" class="btn btn-ghost btn-sm" style="font-size:12px" onclick="insertWaVar('{telefone}')">+ {telefone}</button>
      </div>
      <textarea id="wa_tpl" rows="6" style="font-size:14px" placeholder="Olá {nome},&#10;&#10;Lembramos que o evento acontece amanhã às 20h.&#10;&#10;Até lá!"></textarea>
    </div>
    <div class="wa-preview-box" id="wa_preview" style="display:none"></div>
    <p class="error-msg hidden" id="wa_err" style="text-align:left"></p>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px">
      <button class="btn btn-ghost btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" onclick="startWaSend()">Iniciar envio →</button>
    </div>`);
  const ta = document.getElementById('wa_tpl');
  ta.addEventListener('input', () => updateWaPreview(ta.value));
  ta.focus();
}

function insertWaVar(v) {
  const ta = document.getElementById('wa_tpl');
  if (!ta) return;
  const s = ta.selectionStart, e = ta.selectionEnd;
  ta.value = ta.value.slice(0, s) + v + ta.value.slice(e);
  ta.selectionStart = ta.selectionEnd = s + v.length;
  ta.focus();
  updateWaPreview(ta.value);
}

function applyWaTpl(tpl, p) {
  return tpl
    .replace(/\{nome\}/gi, p.name || '')
    .replace(/\{empresa\}/gi, p.company || '')
    .replace(/\{telefone\}/gi, p.phone || '');
}

function updateWaPreview(tpl) {
  const box = document.getElementById('wa_preview');
  if (!box || !WA_SESSION || !WA_SESSION.sel.length) return;
  if (!tpl.trim()) { box.style.display = 'none'; return; }
  const p = WA_SESSION.sel[0];
  const msg = applyWaTpl(tpl, p);
  box.style.display = '';
  box.innerHTML = `<div class="wa-preview-label">Prévia para <strong>${esc(p.name)}</strong>:</div><div class="wa-bubble">${esc(msg).replace(/\n/g, '<br>')}</div>`;
}

function startWaSend() {
  const ta = document.getElementById('wa_tpl');
  const tpl = ta ? ta.value.trim() : '';
  if (!tpl) {
    const err = document.getElementById('wa_err');
    if (err) { err.textContent = 'Digite a mensagem antes de continuar.'; err.classList.remove('hidden'); }
    return;
  }
  if (!WA_SESSION) return;
  WA_SESSION.tpl = tpl;
  WA_SESSION.idx = 0;
  closeModal();
  sendNextWa();
}

function sendNextWa() {
  if (!WA_SESSION) return;
  const { sel, tpl, idx } = WA_SESSION;
  if (idx >= sel.length) {
    // Finalizado — registra no histórico de cada participante.
    Api.post(`/api/events/${ID}/participants/mass`, { action: 'whatsapp', ids: sel.map((p) => p.id) }).catch(() => {});
    toast(`WhatsApp preparado para ${sel.length} participante(s). Registrado no histórico.`);
    WA_SESSION = null;
    clearSelection();
    loadParticipants();
    return;
  }
  const p = sel[idx];
  const msg = applyWaTpl(tpl, p);
  const waUrl = `${guestWa(p.phone)}?text=${encodeURIComponent(msg)}`;
  modal(`
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
      <span class="wa-counter">${idx + 1}/${sel.length}</span>
      <div>
        <div style="font-weight:600;font-size:15px">${esc(p.name)}</div>
        ${p.company ? `<div class="muted" style="font-size:12px">${esc(p.company)}</div>` : ''}
        ${p.phone ? `<div class="muted" style="font-size:12px">${esc(p.phone)}</div>` : ''}
      </div>
    </div>
    <div class="wa-bubble">${esc(msg).replace(/\n/g, '<br>')}</div>
    <p class="muted" style="font-size:12px;margin:10px 0 0;text-align:center">Após enviar no WhatsApp, volte aqui para o próximo</p>
    <div style="display:flex;gap:10px;justify-content:space-between;margin-top:14px;flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm" onclick="WA_SESSION=null;closeModal();clearSelection()">Cancelar</button>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost btn-sm" onclick="WA_SESSION.idx++;sendNextWa()">Pular →</button>
        <a class="btn btn-sm btn-wa-open" href="${waUrl}" target="_blank" rel="noopener"
           onclick="setTimeout(()=>{if(WA_SESSION){WA_SESSION.idx++;sendNextWa();}},600)">
          <img src="/assets/img/whatsapp.png" width="15" height="15" style="display:block;flex-shrink:0" alt="" />
          Abrir WhatsApp
        </a>
      </div>
    </div>`);
}

// Leva o cursor para a busca rápida de participantes (sem rolar a página).
function focusSearch() {
  const el = document.getElementById('search');
  if (el && !('ontouchstart' in window)) el.focus({ preventScroll: true });
}

(async () => {
  await loadEvent();
  await loadParticipants();
  focusSearch();
})().catch((e) => toast(e.message));
document.getElementById('refreshSlot').appendChild(refreshButton(async () => { await loadParticipants(); focusSearch(); }, 'Atualizar lista'));
