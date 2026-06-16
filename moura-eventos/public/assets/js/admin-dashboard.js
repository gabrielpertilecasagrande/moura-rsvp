requireSession();
mountShell('dashboard');

const STATUS_COLORS = {
  'Planejamento': 'tone-gray',
  'Contratação':  'tone-cyan',
  'Produção':     'tone-navy',
  'Evento realizado': 'tone-cyan',
  'Encerrado':    'tone-gray',
};

function fmtMoney(v) {
  if (v == null) return '—';
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function load() {
  const d = await Api.get('/api/dashboard');

  // Stats
  const byStatus = {};
  (d.byStatus || []).forEach((r) => { byStatus[r.status] = r.n; });
  const active = (byStatus['Planejamento'] || 0) + (byStatus['Contratação'] || 0) + (byStatus['Produção'] || 0);

  document.getElementById('stats').innerHTML = `
    <div class="stat tone-navy"><div class="stat-value">${d.totalEvents}</div><div class="stat-label">Total de Eventos</div></div>
    <div class="stat tone-cyan"><div class="stat-value">${active}</div><div class="stat-label">Em Andamento</div></div>
    <div class="stat tone-gray"><div class="stat-value">${d.totalSuppliers}</div><div class="stat-label">Fornecedores</div></div>
    <div class="stat tone-red"><div class="stat-value">${d.overdueTasks || 0}</div><div class="stat-label">Tarefas Vencidas</div></div>
    <div class="stat tone-gray"><div class="stat-value">${d.pendingContractsCount || 0}</div><div class="stat-label">Contratos Pendentes</div></div>
    <div class="stat tone-red"><div class="stat-value">${fmtMoney(d.pendingPaymentsValue)}</div><div class="stat-label">Pagamentos Pendentes</div></div>
  `;

  // Próximos eventos
  const upcomingEl = document.getElementById('upcomingEvents');
  if (!d.upcomingEvents || d.upcomingEvents.length === 0) {
    upcomingEl.innerHTML = '<p class="muted">Nenhum evento próximo.</p>';
  } else {
    upcomingEl.innerHTML = `<div class="table-wrap"><table><thead><tr>
      <th>Evento</th><th>Cliente</th><th>Data</th><th>Status</th><th></th>
    </tr></thead><tbody>
    ${d.upcomingEvents.map((e) => `<tr>
      <td><a href="/admin/event-detail.html?id=${e.id}" style="font-weight:500">${esc(e.name)}</a></td>
      <td>${esc(e.client || '—')}</td>
      <td>${e.event_date ? fmtDateBR(e.event_date) : '—'}</td>
      <td><span class="pill ${statusPill(e.status)}">${esc(e.status)}</span></td>
      <td><a href="/admin/event-detail.html?id=${e.id}" class="btn btn-ghost btn-sm">Ver</a></td>
    </tr>`).join('')}
    </tbody></table></div>`;
  }

  // Eventos por status
  const ALL_STATUS = ['Planejamento', 'Contratação', 'Produção', 'Evento realizado', 'Encerrado'];
  document.getElementById('byStatus').innerHTML = ALL_STATUS.map((s) => {
    const n = byStatus[s] || 0;
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--gray-soft)">
      <span class="pill ${statusPill(s)}" style="font-size:12px">${esc(s)}</span>
      <strong style="font-size:18px">${n}</strong>
    </div>`;
  }).join('');

  // Eventos recentes
  const recentEl = document.getElementById('recentEvents');
  if (!d.recentEvents || d.recentEvents.length === 0) {
    recentEl.innerHTML = '<p class="muted">Nenhum evento ainda.</p>';
  } else {
    recentEl.innerHTML = `<div class="table-wrap"><table><thead><tr>
      <th>Evento</th><th>Cliente</th><th>Data</th><th>Status</th><th></th>
    </tr></thead><tbody>
    ${d.recentEvents.map((e) => `<tr>
      <td><a href="/admin/event-detail.html?id=${e.id}" style="font-weight:500">${esc(e.name)}</a></td>
      <td>${esc(e.client || '—')}</td>
      <td>${e.event_date ? fmtDateBR(e.event_date) : '—'}</td>
      <td><span class="pill ${statusPill(e.status)}">${esc(e.status)}</span></td>
      <td><a href="/admin/event-detail.html?id=${e.id}" class="btn btn-ghost btn-sm">Ver</a></td>
    </tr>`).join('')}
    </tbody></table></div>`;
  }

  // Atividade recente
  const actEl = document.getElementById('recentActivity');
  if (!d.recentActivity || d.recentActivity.length === 0) {
    actEl.innerHTML = '<p class="muted">Nenhuma atividade ainda.</p>';
  } else {
    actEl.innerHTML = `<div class="table-wrap"><table><thead><tr>
      <th>Usuário</th><th>Ação</th><th>Detalhes</th><th>Quando</th>
    </tr></thead><tbody>
    ${d.recentActivity.map((a) => `<tr>
      <td>${esc(a.actor || '—')}</td>
      <td>${esc(a.action)}</td>
      <td class="muted">${esc(a.details || '—')}</td>
      <td class="muted" style="white-space:nowrap">${fmtDateTimeBR(a.created_at)}</td>
    </tr>`).join('')}
    </tbody></table></div>`;
  }

  document.getElementById('refreshSlot').innerHTML = '';
  document.getElementById('refreshSlot').appendChild(refreshButton(load, 'Atualizar dashboard'));
}

function statusPill(s) {
  const map = { 'Planejamento': '', 'Contratação': 'pill-active', 'Produção': 'pill-ok', 'Evento realizado': 'pill-ok', 'Encerrado': '' };
  return map[s] || '';
}

load().catch(console.error);
