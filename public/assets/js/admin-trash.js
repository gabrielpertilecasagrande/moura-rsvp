requireSession();
if (currentRole() !== 'admin') location.href = '/admin/dashboard.html';
mountShell('trash');

let trashRows = [];
let activeFilter = 'all';   // all | event | participant | user | category
let searchTerm = '';

const TYPE_LABEL = { event: 'Evento', participant: 'Convidado', user: 'Usuário', category: 'Categoria' };
const TYPE_ICON  = { event: Icon('calendar'), participant: Icon('users'), user: Icon('badge'), category: Icon('ticket') };
const TYPE_PATH  = { event: 'event', participant: 'participant', user: 'user', category: 'category' };
const ROLE_LABEL = { admin: 'Administrador', gestor: 'Gestor de Eventos', operador: 'Operador', editor: 'Gestor de Eventos' };

function findItem(type, id) { return trashRows.find((r) => r.type === type && String(r.id) === String(id)); }

// ── Prazo de remoção automática ───────────────────────────────────────────────
function daysUntil(purgeAt) {
  if (!purgeAt) return null;
  const target = new Date(purgeAt.replace(' ', 'T') + 'Z');
  return Math.ceil((target.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}
function purgeInfoHtml(purgeAt) {
  if (!purgeAt) return '<span class="muted">—</span>';
  const days = daysUntil(purgeAt);
  const dateStr = fmtDateTimeBR(purgeAt).split(' ')[0];
  let chip;
  if (days <= 0) chip = '<span class="trash-days trash-days-soon">Removendo…</span>';
  else if (days <= 7) chip = `<span class="trash-days trash-days-soon">Restam ${days} ${days === 1 ? 'dia' : 'dias'}</span>`;
  else chip = `<span class="trash-days">Restam ${days} dias</span>`;
  return `<div style="line-height:1.5">Será removido em<br><strong>${esc(dateStr)}</strong> ${chip}</div>`;
}

// ── Contagem no topo ──────────────────────────────────────────────────────────
function renderSummary() {
  const el = document.getElementById('trashSummaryText');
  const n = trashRows.length;
  if (n === 0) { el.innerHTML = 'A lixeira está vazia. Nada aguardando exclusão.'; return; }
  if (n === 1) {
    const t = (TYPE_LABEL[trashRows[0].type] || 'Item').toLowerCase();
    el.innerHTML = `<strong>1 ${t}</strong> aguardando exclusão definitiva.`;
    return;
  }
  el.innerHTML = `<strong>${n} itens</strong> na lixeira aguardando exclusão definitiva.`;
}

// ── Filtro rápido + busca ─────────────────────────────────────────────────────
function visibleRows() {
  const q = searchTerm.trim().toLowerCase();
  return trashRows.filter((e) => {
    if (activeFilter !== 'all' && e.type !== activeFilter) return false;
    if (!q) return true;
    return [e.name, e.email, e.event_name, e.deleted_by].filter(Boolean).join(' ').toLowerCase().includes(q);
  });
}

function itemSubtitle(e) {
  if (e.type === 'participant') {
    return [e.event_name, e.response === 'confirmado' ? 'Confirmado' : (e.response === 'recusado' ? 'Recusou' : '')].filter(Boolean).join(' · ') || 'Convidado';
  }
  if (e.type === 'user') {
    return [e.email, ROLE_LABEL[e.role] || e.role].filter(Boolean).join(' · ') || 'Usuário';
  }
  if (e.type === 'category') {
    return e.event_name || 'Categoria';
  }
  const parts = [];
  if (e.event_date) parts.push('Data: ' + fmtDateBR(e.event_date));
  if (e.location) parts.push(e.location);
  if (e.participant_count != null) parts.push(`${e.participant_count} convidado(s)`);
  return parts.join(' · ') || 'Evento';
}

function render() {
  renderSummary();
  const tb = document.getElementById('rows');
  const rows = visibleRows();
  if (!trashRows.length) {
    tb.innerHTML = '<tr><td colspan="6" class="muted" style="padding:30px;text-align:center">Nenhum item na lixeira.</td></tr>';
    return;
  }
  if (!rows.length) {
    tb.innerHTML = '<tr><td colspan="6" class="muted" style="padding:30px;text-align:center">Nenhum item encontrado com esse filtro/busca.</td></tr>';
    return;
  }
  tb.innerHTML = rows.map((e) => `
    <tr>
      <td data-label="Item">
        <strong>${TYPE_ICON[e.type] || '📦'} ${esc(e.name)}</strong>
        <div class="muted" style="font-size:12.5px;margin-top:2px">${esc(itemSubtitle(e))}</div>
      </td>
      <td data-label="Tipo"><span class="pill pill-inactive">${esc(TYPE_LABEL[e.type] || 'Item')}</span></td>
      <td data-label="Excluído por">${e.deleted_by ? esc(e.deleted_by) : '<span class="muted">—</span>'}</td>
      <td data-label="Excluído em" style="white-space:nowrap">${fmtDateTimeBR(e.deleted_at)}</td>
      <td data-label="Remoção automática">${purgeInfoHtml(e.purge_at)}</td>
      <td class="cell-actions" data-label="Ações">
        <button class="btn btn-ghost btn-sm" onclick="previewItem('${e.type}', ${e.id})">Visualizar</button>
        <button class="btn btn-ghost btn-sm" onclick="restoreItem('${e.type}', ${e.id})">Restaurar</button>
        <button class="btn btn-danger btn-sm" title="Excluir permanentemente" onclick="purgeItem('${e.type}', ${e.id})">${Icon('trash')} Excluir</button>
      </td>
    </tr>`).join('');
}

async function load() {
  const data = await Api.get('/api/trash').catch(() => ({ events: [], participants: [], users: [], categories: [] }));
  const events = data.events || [];
  const participants = data.participants || [];
  const users = data.users || [];
  const categories = data.categories || [];
  trashRows = [...events, ...participants, ...users, ...categories].sort((a, b) => (a.deleted_at < b.deleted_at ? 1 : -1));
  render();
}

// ── Janela modal (mesmo padrão das outras telas) ──────────────────────────────
function modal(html) {
  document.getElementById('modalSlot').innerHTML =
    `<div class="modal-bg" onclick="if(event.target===this&&document._mdTarget===this)closeModal()"><div class="modal">${html}</div></div>`;
}
function closeModal() { document.getElementById('modalSlot').innerHTML = ''; }

const lineHtml = (label, value) => `
  <div style="display:flex;justify-content:space-between;gap:14px;padding:7px 0;border-bottom:1px solid var(--gray-soft)">
    <span class="muted" style="font-size:13px">${label}</span>
    <strong style="font-size:13.5px;text-align:right">${value}</strong>
  </div>`;

// ── Visualizar antes de restaurar ─────────────────────────────────────────────
async function previewItem(type, id) {
  try {
    const data = await Api.get(`/api/trash/${TYPE_PATH[type]}/${id}/preview`);
    if (type === 'event') return previewEvent(id, data);
    if (type === 'participant') return previewParticipant(id, data);
    if (type === 'category') return previewCategory(id, data);
    return previewUser(id, data);
  } catch (err) { toast(err.message || 'Não foi possível abrir a pré-visualização.'); }
}

function previewEvent(id, { event, counts }) {
  modal(`
    <h2 style="margin-bottom:4px">${TYPE_ICON.event} ${esc(event.name)}</h2>
    <div class="muted" style="font-size:13px;margin-bottom:16px">Pré-visualização do que está guardado na lixeira</div>
    ${lineHtml('Data', event.event_date ? fmtDateBR(event.event_date) : '—')}
    ${lineHtml('Local', esc(event.location || event.city || '—'))}
    ${lineHtml('Situação', event.status === 'ativo' ? 'Ativo' : 'Inativo')}
    <div style="height:10px"></div>
    ${lineHtml(`${Icon('users')} Convidados`, counts.total)}
    ${lineHtml(`${Icon('checklist')} Confirmados`, counts.confirmed)}
    ${lineHtml(`${Icon('warning')} Recusas`, counts.declined)}
    <p class="muted" style="font-size:12.5px;margin-top:10px">ℹ️ Ao restaurar o evento, todos os convidados e o histórico voltam com ele. O link público volta a funcionar.</p>
    ${previewButtons('event', id)}`);
}

function previewParticipant(id, { participant }) {
  modal(`
    <h2 style="margin-bottom:4px">${TYPE_ICON.participant} ${esc(participant.name)}</h2>
    <div class="muted" style="font-size:13px;margin-bottom:16px">Pré-visualização do que está guardado na lixeira</div>
    ${lineHtml('Evento', esc(participant.event_name || '—'))}
    ${lineHtml('Resposta', participant.response === 'confirmado' ? 'Confirmado' : (participant.response === 'recusado' ? 'Recusou' : '—'))}
    ${lineHtml('Empresa', esc(participant.company || '—'))}
    ${lineHtml('Cargo', esc(participant.role || '—'))}
    ${lineHtml('E-mail', esc(participant.email || '—'))}
    ${lineHtml('Telefone', esc(participant.phone || '—'))}
    ${previewButtons('participant', id)}`);
}

function previewCategory(id, { category }) {
  modal(`
    <h2 style="margin-bottom:4px">${TYPE_ICON.category} ${esc(category.name)}</h2>
    <div class="muted" style="font-size:13px;margin-bottom:16px">Pré-visualização do que está guardado na lixeira</div>
    ${lineHtml('Evento', esc(category.event_name || '—'))}
    ${lineHtml('Cor', `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${esc(category.color || '#2C427E')};vertical-align:middle;margin-right:6px"></span>${esc(category.color || '—')}`)}
    <p class="muted" style="font-size:12.5px;margin-top:10px">ℹ️ Ao restaurar, a categoria volta a existir, mas os convidados que ficaram sem categoria não são recategorizados automaticamente.</p>
    ${previewButtons('category', id)}`);
}

function previewUser(id, { user }) {
  modal(`
    <h2 style="margin-bottom:4px">${TYPE_ICON.user} ${esc(user.name)}</h2>
    <div class="muted" style="font-size:13px;margin-bottom:16px">Pré-visualização do que está guardado na lixeira</div>
    ${lineHtml('E-mail', esc(user.email || '—'))}
    ${lineHtml('Permissão', esc(ROLE_LABEL[user.role] || user.role || '—'))}
    ${lineHtml('Situação', esc(user.status || '—'))}
    ${lineHtml('Último acesso', user.last_login ? fmtDateTimeBR(user.last_login) : '—')}
    ${lineHtml('Eventos com acesso', user.access_count)}
    <p class="muted" style="font-size:12.5px;margin-top:10px">ℹ️ Ao restaurar, a conta volta a poder fazer login com as mesmas permissões.</p>
    ${previewButtons('user', id)}`);
}

function previewButtons(type, id) {
  return `
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px;flex-wrap:wrap">
      <button class="btn btn-ghost" onclick="closeModal()">Fechar</button>
      <button class="btn btn-primary" onclick="closeModal();restoreItem('${type}', ${id})">Restaurar</button>
    </div>`;
}

// ── Restaurar ─────────────────────────────────────────────────────────────────
async function restoreItem(type, id) {
  const it = findItem(type, id);
  const name = it?.name || 'este item';
  const extra = type === 'event' ? ' Os convidados e o histórico voltam junto.' : '';
  if (!confirm(`Restaurar "${name}" da lixeira?${extra}`)) return;
  try {
    await Api.post(`/api/trash/${TYPE_PATH[type]}/${id}/restore`, {});
    toast('Item restaurado.');
    await load();
  } catch (e) { toast(e.message); }
}

// ── Excluir permanentemente (digitar EXCLUIR) ─────────────────────────────────
function purgeItem(type, id) {
  const it = findItem(type, id);
  const name = it?.name || 'este item';
  const extra = type === 'event'
    ? ' Todos os convidados e o histórico do evento serão apagados para sempre.'
    : type === 'user' ? ' A conta e suas permissões serão apagadas para sempre.'
    : type === 'category' ? ' A categoria será apagada para sempre (os convidados já ficaram sem categoria quando ela foi excluída).'
    : ' O convidado e seu histórico serão apagados para sempre.';
  modal(`
    <h2 style="margin-bottom:6px">${Icon('trash')} Excluir permanentemente</h2>
    <p style="font-size:14px;line-height:1.5;margin-bottom:6px">
      Exclusão <strong>PERMANENTE e irreversível</strong> de "<strong>${esc(name)}</strong>".${extra}
    </p>
    <p class="muted" style="font-size:13px;margin-bottom:10px">Para confirmar, digite <strong>EXCLUIR</strong> abaixo.</p>
    <input type="text" id="purgeWord" placeholder="Digite EXCLUIR" autocomplete="off" style="width:100%;margin-bottom:16px" />
    <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-danger" id="purgeConfirm" disabled>${Icon('trash')} Excluir permanentemente</button>
    </div>`);
  const input = document.getElementById('purgeWord');
  const btn = document.getElementById('purgeConfirm');
  input.addEventListener('input', () => { btn.disabled = input.value.trim().toUpperCase() !== 'EXCLUIR'; });
  input.focus();
  btn.addEventListener('click', async () => {
    if (input.value.trim().toUpperCase() !== 'EXCLUIR') return;
    try {
      await Api.del(`/api/trash/${TYPE_PATH[type]}/${id}`);
      closeModal();
      toast('Item excluído permanentemente.');
      await load();
    } catch (e) { toast(e.message); }
  });
}

// ── Ligações de UI ────────────────────────────────────────────────────────────
document.getElementById('trashSearch').addEventListener('input', (e) => { searchTerm = e.target.value; render(); });
document.getElementById('trashFilter').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-filter]');
  if (!btn) return;
  activeFilter = btn.getAttribute('data-filter');
  document.querySelectorAll('#trashFilter button').forEach((b) => b.classList.toggle('active', b === btn));
  render();
});

const refreshSlot = document.getElementById('refreshSlot');
if (refreshSlot && typeof refreshButton === 'function') refreshSlot.appendChild(refreshButton(load, 'Atualizar lixeira'));

load().catch((e) => toast(e.message));
