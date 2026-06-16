requireSession();
mountShell('clients');

let allClients = [];

function fmtMoney(v) {
  if (!v) return 'R$ 0,00';
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function statusPill(s) {
  const map = { 'Planejamento': '', 'Contratação': 'pill-active', 'Produção': 'pill-ok', 'Evento realizado': 'pill-ok', 'Encerrado': '' };
  return `<span class="pill ${map[s] || ''}">${esc(s)}</span>`;
}

function render(list) {
  const el = document.getElementById('clientList');
  if (!list.length) { el.innerHTML = '<div class="empty-state"><div class="ico">👥</div><h3>Nenhum cliente</h3><p>Os clientes aparecem aqui conforme você cadastra eventos com o campo Cliente preenchido.</p></div>'; return; }
  el.innerHTML = list.map((c, i) => {
    const initials = c.client.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    return `<div class="client-card" data-i="${i}">
      <div class="client-top" onclick="toggleCard(${i})">
        <div class="client-avatar">${esc(initials || '?')}</div>
        <div class="client-info">
          <div class="client-name">${esc(c.client)}</div>
          <div class="client-sub">${c.events_count} evento(s) · ${fmtMoney(c.total_value)} contratado</div>
        </div>
        <span class="chev">▸</span>
      </div>
      <div class="client-events">
        ${c.events.map((e) => `<div class="client-ev">
          <div>
            <a href="/admin/event-detail.html?id=${e.id}" style="font-weight:600">${esc(e.name)}</a>
            <div class="client-sub">${e.event_date ? fmtDateBR(e.event_date) : 'Sem data'} · ${fmtMoney(e.total_value)}</div>
          </div>
          ${statusPill(e.status)}
        </div>`).join('')}
      </div>
    </div>`;
  }).join('');
}

function toggleCard(i) {
  const card = document.querySelector(`.client-card[data-i="${i}"]`);
  if (card) card.classList.toggle('open');
}

function applyFilter() {
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  render(q ? allClients.filter((c) => c.client.toLowerCase().includes(q)) : allClients);
}

document.getElementById('searchInput').addEventListener('input', applyFilter);

async function load() {
  allClients = await Api.get('/api/clients');
  render(allClients);
}
load().catch(console.error);
