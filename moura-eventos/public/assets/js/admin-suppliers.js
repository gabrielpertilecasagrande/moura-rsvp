requireSession();
mountShell('suppliers');

async function load() {
  const q        = document.getElementById('searchInput').value.trim();
  const category = document.getElementById('categoryFilter').value;
  const params   = new URLSearchParams();
  if (q)        params.set('q', q);
  if (category) params.set('category', category);

  const suppliers = await Api.get('/api/suppliers?' + params.toString());
  render(suppliers);
}

function categoryColor(cat) {
  const colors = {
    'Sonorização': '#2BC2CE', 'Iluminação': '#f4a261', 'LED': '#7c6fcd',
    'Streaming': '#2BC2CE', 'Fotografia': '#e76f51', 'Filmagem': '#e76f51',
    'Buffet': '#2a9d8f', 'Decoração': '#e9c46a', 'Cerimonial': '#264653',
    'Segurança': '#c2553e', 'Recepção': '#2BC2CE', 'Brindes': '#f4a261',
    'Transporte': '#6b6f78', 'Hospedagem': '#2C427E',
  };
  return colors[cat] || 'var(--navy)';
}

function render(suppliers) {
  const body = document.getElementById('supplierBody');
  if (!suppliers.length) {
    body.innerHTML = '<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">Nenhum fornecedor encontrado.</td></tr>';
    return;
  }
  body.innerHTML = suppliers.map((s) => `<tr>
    <td><a href="/admin/supplier-form.html?id=${s.id}" style="font-weight:600">${esc(s.company)}</a></td>
    <td>${s.category ? `<span class="pill" style="background:${categoryColor(s.category)}20;color:${categoryColor(s.category)};border-color:${categoryColor(s.category)}40">${esc(s.category)}</span>` : '—'}</td>
    <td>${esc(s.contact || '—')}</td>
    <td>${s.whatsapp ? `<a href="https://wa.me/55${s.whatsapp.replace(/\D/g,'')}" target="_blank" class="btn btn-ghost btn-sm">📱 WhatsApp</a>` : '—'}</td>
    <td>${esc(s.city || '—')}</td>
    <td style="text-align:center">${s.contracts_count || 0}</td>
    <td style="white-space:nowrap">
      <a href="/admin/supplier-form.html?id=${s.id}" class="btn btn-ghost btn-sm">Editar</a>
      ${currentRole() === 'admin' ? `<button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteSupplier(${s.id},'${esc(s.company).replace(/'/g,"\\'")}')">Excluir</button>` : ''}
    </td>
  </tr>`).join('');
}

async function deleteSupplier(id, name) {
  if (!confirm(`Excluir fornecedor "${name}"? Esta ação não pode ser desfeita.`)) return;
  try {
    await Api.del(`/api/suppliers/${id}`);
    toast('Fornecedor excluído.');
    load();
  } catch (e) { toast(e.message); }
}

let debounce;
document.getElementById('searchInput').addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(load, 300); });
document.getElementById('categoryFilter').addEventListener('change', load);

load().catch(console.error);
