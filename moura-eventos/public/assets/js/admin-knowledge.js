requireSession();
mountShell('knowledge');

const canWrite = () => ['admin', 'gestor'].includes(currentRole());

if (canWrite()) {
  document.getElementById('newArticleBtn').style.display = '';
}

let allArticles = [];
let searchQ    = '';
let searchCat  = '';

const CATEGORIES = ['Processos', 'Modelos e templates', 'Fornecedores', 'Boas práticas', 'Jurídico / Contratos', 'Outros'];
const CAT_COLORS = {
  'Processos':          'pill-ok',
  'Modelos e templates':'pill-active',
  'Fornecedores':       '',
  'Boas práticas':      'pill-ok',
  'Jurídico / Contratos': '',
  'Outros':             '',
};

async function load() {
  const params = new URLSearchParams();
  if (searchQ)   params.set('q', searchQ);
  if (searchCat) params.set('category', searchCat);
  allArticles = await Api.get('/api/knowledge?' + params.toString());
  render();
}

function catPill(cat) {
  return `<span class="pill ${CAT_COLORS[cat] || ''}" style="font-size:11px">${esc(cat)}</span>`;
}

function render() {
  const el = document.getElementById('kbContent');
  if (!allArticles.length) {
    el.innerHTML = `<div class="kb-empty"><div class="ico">📚</div><div>Nenhum artigo encontrado.</div>${canWrite() ? '<div style="margin-top:12px"><button class="btn btn-primary btn-sm" onclick="openArticleModal(null)">+ Criar primeiro artigo</button></div>' : ''}</div>`;
    return;
  }
  el.innerHTML = `<div class="kb-grid">${allArticles.map((a) => `
    <div class="kb-card" onclick="openArticleView(${a.id})">
      <div style="display:flex;gap:8px;align-items:flex-start;justify-content:space-between;margin-bottom:6px">
        ${catPill(a.category)}
        ${a.tags ? `<span class="muted" style="font-size:11px;flex:1;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.tags)}</span>` : ''}
      </div>
      <div class="kb-title">${esc(a.title)}</div>
      <div class="kb-excerpt">${esc(a.excerpt || '')}</div>
      <div class="kb-meta">
        <span>${esc(a.author || '—')}</span>
        <span>·</span>
        <span>${fmtDateTimeBR(a.updated_at)}</span>
      </div>
      ${canWrite() ? `<div class="kb-actions" onclick="event.stopPropagation()">
        <button class="btn btn-ghost btn-sm" onclick="openArticleModal(${a.id})">Editar</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteArticle(${a.id})">Remover</button>
      </div>` : ''}
    </div>`).join('')}</div>`;
}

async function openArticleView(id) {
  const a = await Api.get(`/api/knowledge/${id}`);
  document.getElementById('modalSlot').innerHTML = `
    <div class="modal-bg" onclick="if(event.target===this)closeKbModal()">
      <div class="modal" style="max-width:680px;max-height:85vh;overflow-y:auto">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;gap:12px">
          <div>
            ${catPill(a.category)}
            <h2 style="font-size:20px;color:var(--navy);margin:8px 0 4px">${esc(a.title)}</h2>
            <div class="muted" style="font-size:12px">${esc(a.author || '—')} · ${fmtDateTimeBR(a.updated_at)}${a.tags ? ' · ' + esc(a.tags) : ''}</div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="closeKbModal()">✕</button>
        </div>
        <div class="rich" style="font-size:14px;line-height:1.75;margin-top:16px">${renderRich(a.content)}</div>
        ${canWrite() ? `<div style="display:flex;gap:8px;margin-top:20px;border-top:1px solid var(--gray-soft);padding-top:16px">
          <button class="btn btn-ghost btn-sm" onclick="closeKbModal();openArticleModal(${a.id})">Editar artigo</button>
        </div>` : ''}
      </div>
    </div>`;
}

function closeKbModal() {
  document.getElementById('modalSlot').innerHTML = '';
}

async function openArticleModal(id) {
  let a = null;
  if (id) a = await Api.get(`/api/knowledge/${id}`);
  const isEdit = !!a;

  document.getElementById('modalSlot').innerHTML = `
    <div class="modal-bg">
      <div class="modal" style="max-width:640px">
        <h2>${isEdit ? 'Editar artigo' : 'Novo artigo'}</h2>
        <div class="field"><label>Título *</label><input type="text" id="kaTitle" value="${esc(a?.title || '')}" /></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="field"><label>Categoria</label>
            <select id="kaCat">
              ${CATEGORIES.map((c) => `<option ${(a?.category || 'Outros') === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Tags (separadas por vírgula)</label><input type="text" id="kaTags" value="${esc(a?.tags || '')}" placeholder="ex: checklist, buffet, prazo" /></div>
        </div>
        <div class="field"><label>Conteúdo *</label>
          <div id="kaContentFmt"></div>
          <textarea id="kaContent" rows="10" style="font-family:inherit">${esc(a?.content || '')}</textarea>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button class="btn btn-ghost" onclick="closeKbModal()">Cancelar</button>
          <button class="btn btn-primary" id="kaSaveBtn">Salvar</button>
        </div>
      </div>
    </div>`;

  document.getElementById('kaContentFmt').innerHTML = formatToolbar('kaContent');

  document.getElementById('kaSaveBtn').addEventListener('click', async () => {
    const title   = document.getElementById('kaTitle').value.trim();
    const content = document.getElementById('kaContent').value.trim();
    if (!title)   { toast('Informe o título.'); return; }
    if (!content) { toast('Informe o conteúdo.'); return; }
    const body = {
      title,
      category: document.getElementById('kaCat').value,
      content,
      tags: document.getElementById('kaTags').value.trim() || null,
    };
    try {
      if (isEdit) await Api.put(`/api/knowledge/${a.id}`, body);
      else        await Api.post('/api/knowledge', body);
      closeKbModal();
      toast('Artigo salvo.');
      await load();
    } catch (e) { toast(e.message); }
  });
}

async function deleteArticle(id) {
  if (!confirm('Remover este artigo permanentemente?')) return;
  try {
    await Api.del(`/api/knowledge/${id}`);
    toast('Artigo removido.');
    await load();
  } catch (e) { toast(e.message); }
}

document.getElementById('newArticleBtn').addEventListener('click', () => openArticleModal(null));

let debounce;
document.getElementById('searchInput').addEventListener('input', (e) => {
  searchQ = e.target.value.trim();
  clearTimeout(debounce);
  debounce = setTimeout(load, 300);
});
document.getElementById('catFilter').addEventListener('change', (e) => {
  searchCat = e.target.value;
  load();
});

load().catch(console.error);
