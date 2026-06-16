requireSession();
mountShell('calendar');

const MONTHS = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const DOW = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

let viewYear, viewMonth; // mês exibido
const today = new Date();

function ymd(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

document.getElementById('calDow').innerHTML = DOW.map((d) => `<div class="cal-dow">${d}</div>`).join('');

async function render() {
  document.getElementById('calTitle').textContent = `${MONTHS[viewMonth]} ${viewYear}`;

  const first = new Date(viewYear, viewMonth, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const gridStart = new Date(viewYear, viewMonth, 1 - startDow);

  // Intervalo cobrindo a grade (6 semanas)
  const from = ymd(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate());
  const toDate = new Date(gridStart); toDate.setDate(toDate.getDate() + 41);
  const to = ymd(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());

  let data = { events: [], tasks: [], payments: [] };
  try { data = await Api.get(`/api/calendar?from=${from}&to=${to}`); } catch (e) { toast(e.message); }

  // Indexa por data
  const byDate = {};
  const push = (date, html) => { if (!date) return; (byDate[date] = byDate[date] || []).push(html); };
  data.events.forEach((e) => push(e.date, `<a class="cal-item ci-event" href="/admin/event-detail.html?id=${e.id}" title="${escAttr(e.name)}">${esc(e.name)}</a>`));
  data.tasks.forEach((t) => push(t.date, `<a class="cal-item ci-task" href="/admin/event-detail.html?id=${t.event_id}" title="${escAttr(t.title + ' · ' + t.event_name)}">⚑ ${esc(t.title)}</a>`));
  data.payments.forEach((p) => push(p.date, `<a class="cal-item ci-payment" href="/admin/event-detail.html?id=${p.event_id}" title="${escAttr('Pagamento ' + p.company)}">$ ${esc(p.company)}</a>`));

  const todayStr = ymd(today.getFullYear(), today.getMonth(), today.getDate());
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart); d.setDate(d.getDate() + i);
    const dateStr = ymd(d.getFullYear(), d.getMonth(), d.getDate());
    const other = d.getMonth() !== viewMonth;
    const isToday = dateStr === todayStr;
    const items = (byDate[dateStr] || []).slice(0, 4).join('');
    const extra = (byDate[dateStr] || []).length > 4 ? `<span style="font-size:10px;color:var(--muted)">+${byDate[dateStr].length - 4} mais</span>` : '';
    cells += `<div class="cal-cell ${other ? 'other' : ''} ${isToday ? 'today' : ''}">
      <span class="cal-daynum">${d.getDate()}</span>${items}${extra}</div>`;
  }
  document.getElementById('calGrid').innerHTML = cells;
}

function escAttr(s) { return esc(s).replace(/"/g, '&quot;'); }

document.getElementById('prevBtn').addEventListener('click', () => { viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; } render(); });
document.getElementById('nextBtn').addEventListener('click', () => { viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; } render(); });
document.getElementById('todayBtn').addEventListener('click', () => { viewYear = today.getFullYear(); viewMonth = today.getMonth(); render(); });

viewYear = today.getFullYear();
viewMonth = today.getMonth();
render().catch(console.error);
