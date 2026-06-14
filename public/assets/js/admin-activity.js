requireSession();
if (currentRole() !== 'admin') location.href = '/admin/dashboard.html';
mountShell('activity');

async function load(q) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  const rows = await Api.get(`/api/activity?${params}`);
  const tb = document.getElementById('rows');
  if (!rows.length) {
    tb.innerHTML = '<tr><td colspan="4" class="muted center" style="padding:30px">Nenhuma atividade registrada ainda.</td></tr>';
    return;
  }
  tb.innerHTML = rows.map((r) => `
    <tr>
      <td class="row-name" style="font-variant-numeric:tabular-nums">${fmtDateTimeBR(r.created_at)}</td>
      <td data-label="Usuário">${esc(r.actor || '—')}</td>
      <td data-label="Ação">${esc(r.action)}</td>
      <td data-label="Detalhe" class="break-anywhere">${esc(r.details || '—')}</td>
    </tr>`).join('');
}

let t;
document.getElementById('search').addEventListener('input', (e) => {
  clearTimeout(t); t = setTimeout(() => load(e.target.value.trim()), 250);
});
load().catch((e) => toast(e.message));
