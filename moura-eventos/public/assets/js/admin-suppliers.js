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
  body.innerHTML = suppliers.map((s) => {
    const stars = s.rating > 0 ? '★'.repeat(s.rating) + '☆'.repeat(5 - s.rating) : '—';
    const starColor = s.rating > 0 ? '#f4a261' : 'var(--muted)';
    const cityState = [s.city, s.state].filter(Boolean).join(' / ');
    return `<tr>
    <td><a href="/admin/supplier-form.html?id=${s.id}" style="font-weight:600">${esc(s.company)}</a></td>
    <td>${s.category ? `<span class="pill" style="background:${categoryColor(s.category)}20;color:${categoryColor(s.category)};border-color:${categoryColor(s.category)}40">${esc(s.category)}</span>` : '—'}</td>
    <td>${esc(s.contact || '—')}</td>
    <td>${s.whatsapp ? `<a href="https://wa.me/55${s.whatsapp.replace(/\D/g,'')}" target="_blank" class="btn btn-ghost btn-sm" style="display:inline-flex;align-items:center;gap:5px"><svg width="14" height="14" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg> WhatsApp</a>` : '—'}</td>
    <td>${esc(cityState || '—')}</td>
    <td style="text-align:center;color:${starColor};letter-spacing:2px;font-size:13px">${stars}</td>
    <td style="text-align:center">${s.contracts_count || 0}</td>
    <td style="white-space:nowrap">
      <a href="/admin/supplier-form.html?id=${s.id}" class="btn btn-ghost btn-sm">Editar</a>
      ${currentRole() === 'admin' ? `<button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteSupplier(${s.id},'${esc(s.company).replace(/'/g,"\\'")}')">Excluir</button>` : ''}
    </td>
  </tr>`;
  }).join('');
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
