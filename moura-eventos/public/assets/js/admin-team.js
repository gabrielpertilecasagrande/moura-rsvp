requireSession();
mountShell('team');

function fmtMoney(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function load() {
  const list = await Api.get('/api/team');
  const el = document.getElementById('teamGrid');
  if (!list.length) {
    el.innerHTML = '<div class="empty-state"><div class="ico">🧑‍💼</div><h3>Sem responsáveis</h3><p>Defina responsáveis nos eventos e nas tarefas para acompanhar a carga da equipe aqui.</p></div>';
    return;
  }
  el.innerHTML = list.map((p) => {
    const initials = p.name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    return `<div class="team-card">
      <div class="team-head">
        <div class="team-avatar">${esc(initials || '?')}</div>
        <div class="team-name">${esc(p.name)}</div>
      </div>
      <div class="team-stats">
        <div class="team-stat"><div class="n">${p.openTasks}</div><div class="l">Tarefas abertas</div></div>
        <div class="team-stat"><div class="n ${p.overdueTasks > 0 ? 'red' : ''}">${p.overdueTasks}</div><div class="l">Atrasadas</div></div>
        <div class="team-stat"><div class="n">${p.events}</div><div class="l">Eventos</div></div>
        <div class="team-stat"><div class="n">${fmtMoney(p.contractsValue)}</div><div class="l">Em contratos</div></div>
      </div>
    </div>`;
  }).join('');
}

load().catch(console.error);
