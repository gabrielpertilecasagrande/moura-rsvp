requireSession();

const params = new URLSearchParams(location.search);
const editId = params.get('id');
const isEdit = !!editId;

mountShell('suppliers');

async function init() {
  if (isEdit) {
    document.getElementById('formEyebrow').textContent = 'Editar';
    document.getElementById('formTitle').textContent = 'Editar Fornecedor';
    const { supplier } = await Api.get(`/api/suppliers/${editId}`);
    document.getElementById('company').value  = supplier.company  || '';
    document.getElementById('contact').value  = supplier.contact  || '';
    document.getElementById('category').value = supplier.category || '';
    document.getElementById('whatsapp').value = supplier.whatsapp || '';
    document.getElementById('email').value    = supplier.email    || '';
    document.getElementById('city').value     = supplier.city     || '';
    document.getElementById('notes').value    = supplier.notes    || '';
  }
}

document.getElementById('saveBtn').addEventListener('click', async () => {
  const company = document.getElementById('company').value.trim();
  if (!company) { toast('Informe o nome da empresa.'); return; }

  const body = {
    company,
    contact:  document.getElementById('contact').value.trim()  || null,
    category: document.getElementById('category').value        || null,
    whatsapp: document.getElementById('whatsapp').value.trim() || null,
    email:    document.getElementById('email').value.trim()    || null,
    city:     document.getElementById('city').value.trim()     || null,
    notes:    document.getElementById('notes').value.trim()    || null,
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
