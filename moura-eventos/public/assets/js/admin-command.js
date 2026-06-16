requireSession();
mountShell('command');

function fmtMoney(v) {
  if (v == null) return '—';
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function daysFrom(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const diff = Math.round((new Date(y, m - 1, d) - new Date(new Date().toISOString().slice(0, 10))) / 864e5);
  return diff;
}
function relTag(dateStr, overdueRed) {
  const d = daysFrom(dateStr);
  if (d == null) return '';
  if (d < 0) return `<span class="badge" style="color:var(--danger)">${Math.abs(d)}d atrás</span>`;
  if (d === 0) return `<span class="badge" style="color:${overdueRed ? 'var(--warn)' : 'var(--muted)'}">hoje</span>`;
  return `<span class="badge" style="color:var(--muted)">em ${d}d</span>`;
}

function col(title, klass, count, items, emptyMsg) {
  return `<div class="cc-col ${klass}">
    <h3>${title} ${count ? `<span class="cc-count">${count}</span>` : ''}</h3>
    ${items.length ? items.join('') : `<div class="cc-empty">${emptyMsg}</div>`}
  </div>`;
}
function item(href, title, sub, badge) {
  return `<a class="cc-item" href="${href}">
    <span><span class="t">${esc(title)}</span><span class="s">${esc(sub)}</span></span>
    ${badge || ''}
  </a>`;
}

async function load() {
  const d = await Api.get('/api/command-center');

  document.getElementById('insights').innerHTML = d.insights.map((i) =>
    `<div class="cc-insight ${i.level}"><span class="dot"></span>${esc(i.text)}</div>`).join('');

  const cols = [];
  cols.push(col('🔴 Tarefas atrasadas', 'danger', d.counts.overdueTasks,
    d.overdueTasks.map((t) => item(`/admin/event-detail.html?id=${t.event_id}`, t.title,
      `${t.event_name}${t.responsible ? ' · ' + t.responsible : ''}`, relTag(t.due_date, true))),
    'Nenhuma tarefa atrasada. 🎉'));

  cols.push(col('⚠️ Tarefas críticas', 'danger', d.counts.criticalTasks,
    d.criticalTasks.map((t) => item(`/admin/event-detail.html?id=${t.event_id}`, t.title,
      `${t.event_name}${t.responsible ? ' · ' + t.responsible : ''}`, t.due_date ? relTag(t.due_date, true) : '')),
    'Nenhuma tarefa crítica em aberto.'));

  cols.push(col('💸 Pagamentos próximos (7 dias)', 'warn', d.counts.upcomingPayments,
    d.upcomingPayments.map((p) => item(`/admin/event-detail.html?id=${p.event_id}`, `${p.company} — ${fmtMoney(p.value)}`,
      p.event_name, relTag(p.payment_due_date, true))),
    'Nenhum pagamento vencendo em 7 dias.'));

  cols.push(col('📅 Eventos próximos (30 dias)', '', d.counts.upcomingEvents,
    d.upcomingEvents.map((e) => item(`/admin/event-detail.html?id=${e.id}`, e.name,
      `${e.client || 'Evento'} · ${e.status}`, relTag(e.event_date, false))),
    'Nenhum evento nos próximos 30 dias.'));

  cols.push(col('🤝 Contratações pendentes', 'warn', d.counts.pendingContracts,
    d.pendingContracts.map((c) => item(`/admin/event-detail.html?id=${c.event_id}`, `${c.company} — ${fmtMoney(c.value)}`,
      `${c.event_name} · ${c.status}`, '')),
    'Nenhuma contratação pendente.'));

  document.getElementById('grid').innerHTML = cols.join('');

  document.getElementById('refreshSlot').innerHTML = '';
  document.getElementById('refreshSlot').appendChild(refreshButton(load, 'Atualizar'));
}

load().catch(console.error);
