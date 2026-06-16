requireSession();

const params = new URLSearchParams(location.search);
const editId = params.get('id');
const isEdit = !!editId;

mountShell('suppliers');

// Rating widget
let currentRating = 0;
const stars = document.querySelectorAll('.star');
function setRating(v) {
  currentRating = v;
  document.getElementById('rating').value = v;
  stars.forEach(s => { s.textContent = Number(s.dataset.v) <= v ? '★' : '☆'; s.style.color = Number(s.dataset.v) <= v ? '#f4a261' : '#ccc'; });
}
stars.forEach(s => {
  s.addEventListener('click', () => setRating(Number(s.dataset.v)));
  s.addEventListener('mouseenter', () => stars.forEach(x => { x.textContent = Number(x.dataset.v) <= Number(s.dataset.v) ? '★' : '☆'; x.style.color = Number(x.dataset.v) <= Number(s.dataset.v) ? '#f4a261' : '#ccc'; }));
  s.addEventListener('mouseleave', () => setRating(currentRating));
});
setRating(0);

function fmtBRL(v) { return new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' }).format(v || 0); }

async function init() {
  if (isEdit) {
    document.getElementById('formEyebrow').textContent = 'Editar';
    document.getElementById('formTitle').textContent = 'Editar Fornecedor';
    const { supplier, stats } = await Api.get(`/api/suppliers/${editId}`);
    document.getElementById('company').value   = supplier.company   || '';
    document.getElementById('contact').value   = supplier.contact   || '';
    document.getElementById('category').value  = supplier.category  || '';
    document.getElementById('whatsapp').value  = supplier.whatsapp  || '';
    document.getElementById('email').value     = supplier.email     || '';
    document.getElementById('city').value      = supplier.city      || '';
    document.getElementById('state').value     = supplier.state     || '';
    document.getElementById('website').value   = supplier.website   || '';
    document.getElementById('instagram').value = supplier.instagram || '';
    document.getElementById('notes').value     = supplier.notes     || '';
    setRating(supplier.rating || 0);

    if (stats && stats.contracts_count > 0) {
      const el = document.getElementById('supplierStats');
      el.style.display = 'block';
      el.innerHTML = `<div style="display:flex;gap:16px;flex-wrap:wrap;padding:12px 16px;background:var(--gray-soft);border-radius:var(--radius);font-size:13px">
        <div><span class="muted">Contratações</span><br><strong>${stats.contracts_count}</strong></div>
        <div><span class="muted">Valor médio</span><br><strong>${fmtBRL(stats.avg_value)}</strong></div>
        ${stats.last_event_name ? `<div><span class="muted">Último evento</span><br><strong>${esc(stats.last_event_name)}</strong></div>` : ''}
      </div>`;
    }
  }
}

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

document.getElementById('saveBtn').addEventListener('click', async () => {
  const company = document.getElementById('company').value.trim();
  if (!company) { toast('Informe o nome da empresa.'); return; }

  const body = {
    company,
    contact:   document.getElementById('contact').value.trim()   || null,
    category:  document.getElementById('category').value         || null,
    whatsapp:  document.getElementById('whatsapp').value.trim()  || null,
    email:     document.getElementById('email').value.trim()     || null,
    city:      document.getElementById('city').value.trim()      || null,
    state:     document.getElementById('state').value.trim().toUpperCase() || null,
    website:   document.getElementById('website').value.trim()   || null,
    instagram: document.getElementById('instagram').value.trim() || null,
    notes:     document.getElementById('notes').value.trim()     || null,
    rating:    currentRating,
  };

  const btn = document.getElementById('saveBtn');
  btn.disabled = true; btn.textContent = 'Salvando…';

  try {
    if (isEdit) {
      await Api.put(`/api/suppliers/${editId}`, body);
    } else {
      await Api.post('/api/suppliers', body);
    }
    toast('Fornecedor salvo.');
    setTimeout(() => location.href = '/admin/suppliers.html', 600);
  } catch (e) {
    toast(e.message);
    btn.disabled = false; btn.textContent = 'Salvar fornecedor';
  }
});

init().catch(console.error);
