mountShell('lgpd');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function fmtDT(s) {
  if (!s) return '—';
  try { return new Date(s.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }); } catch { return s; }
}

// ── Busca ────────────────────────────────────────────────────────────────────
let searchResults = [];

async function runSearch() {
  const q = document.getElementById('eraseSearch').value.trim();
  if (q.length < 2) { alert('Digite ao menos 2 caracteres para buscar.'); return; }
  const resultsEl = document.getElementById('eraseResults');
  resultsEl.innerHTML = '<p class="muted">Buscando…</p>';
  document.getElementById('eraseActions').style.display = 'none';

  try {
    const data = await Api.get('/api/lgpd/search?q=' + encodeURIComponent(q));
    searchResults = data.participants || [];
    renderResults(searchResults);
  } catch (e) {
    resultsEl.innerHTML = `<p style="color:#c0392b">${esc(e.message || 'Erro ao buscar.')}</p>`;
  }
}

function renderResults(list) {
  const el = document.getElementById('eraseResults');
  if (!list.length) {
    el.innerHTML = '<p class="muted">Nenhum convidado encontrado.</p>';
    document.getElementById('eraseActions').style.display = 'none';
    return;
  }

  el.innerHTML = list.map((p) => `
    <label class="erase-row" for="ep-${esc(p.id)}">
      <input type="checkbox" id="ep-${esc(p.id)}" value="${esc(p.id)}" onchange="updateSelCount()" />
      <div class="erase-info">
        <div class="erase-name">
          ${esc(p.name)}
          <span class="erase-badge ${esc(p.response)}">${p.response === 'confirmado' ? 'Confirmado' : 'Recusado'}</span>
        </div>
        <div class="erase-meta">
          ${p.email ? esc(p.email) + ' · ' : ''}${p.phone ? esc(p.phone) + ' · ' : ''}${p.company ? esc(p.company) + ' · ' : ''}Evento: <strong>${esc(p.event_name)}</strong>
        </div>
      </div>
    </label>
  `).join('');

  document.getElementById('eraseActions').style.display = 'block';
  updateSelCount();
}

function updateSelCount() {
  const checked = document.querySelectorAll('#eraseResults input[type=checkbox]:checked');
  const n = checked.length;
  document.getElementById('eraseSelCount').textContent = `${n} selecionado(s)`;
  document.getElementById('eraseBtn').disabled = n === 0;
}

// ── Download PDF autenticado ──────────────────────────────────────────────────
async function downloadReceipt(id, receiptNo) {
  try {
    const res = await fetch(`/api/lgpd/erasures/${id}/receipt.pdf`, {
      headers: { Authorization: `Bearer ${Api.token()}` },
    });
    if (!res.ok) throw new Error('Erro ' + res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `comprovante-exclusao-${receiptNo || id}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Não foi possível baixar o comprovante: ' + (e.message || 'Tente novamente.'));
  }
}

// ── Exclusão ─────────────────────────────────────────────────────────────────
async function runErase() {
  const checked = Array.from(document.querySelectorAll('#eraseResults input[type=checkbox]:checked'));
  if (!checked.length) { alert('Selecione ao menos um convidado.'); return; }

  const ids = checked.map((el) => Number(el.value));
  const n = ids.length;

  const ok = confirm(
    `⚠️ ATENÇÃO: esta ação é PERMANENTE e não pode ser desfeita.\n\n` +
    `Serão excluídos ${n} convidado(s) de forma definitiva.\n\n` +
    `Um comprovante PDF será gerado para auditoria.\n\nDeseja continuar?`
  );
  if (!ok) return;

  document.getElementById('eraseBtn').disabled = true;
  document.getElementById('eraseBtn').textContent = 'Excluindo…';

  try {
    const result = await Api.post('/api/lgpd/erase', {
      ids,
      subject_name: document.getElementById('eraseSubjectName').value.trim() || null,
      subject_email: document.getElementById('eraseSubjectEmail').value.trim() || null,
      reason: document.getElementById('eraseReason').value.trim() || null,
    });

    const pdfUrl = `/api/lgpd/erasures/${result.id}/receipt.pdf`;
    document.getElementById('eraseResults').innerHTML = `
      <div style="background:#d4f7e8;border-radius:10px;padding:14px 16px">
        <div style="font-weight:700;font-size:15px;color:#1a7a50">${Icon('checklist')} ${result.count} convidado(s) excluído(s) com sucesso.</div>
        <div style="font-size:13px;margin-top:6px">Comprovante: <strong style="font-family:monospace">${esc(result.receipt_no)}</strong></div>
        <button class="btn btn-ghost btn-sm" onclick="downloadReceipt(${result.id}, '${esc(result.receipt_no)}')" style="margin-top:10px">${Icon('download')} Baixar comprovante PDF</button>
      </div>`;
    document.getElementById('eraseActions').style.display = 'none';
    document.getElementById('eraseSearch').value = '';
    // Recarrega histórico
    loadErasures();
  } catch (e) {
    alert('Erro ao excluir: ' + (e.message || 'Tente novamente.'));
    document.getElementById('eraseBtn').disabled = false;
    document.getElementById('eraseBtn').innerHTML = `${Icon('trash')} Excluir permanentemente`;
  }
}

// ── Histórico ────────────────────────────────────────────────────────────────
async function loadErasures() {
  const el = document.getElementById('erasuresCard');
  try {
    const rows = await Api.get('/api/lgpd/erasures');
    if (!rows.length) {
      el.innerHTML = '<p class="muted">Nenhuma exclusão registrada ainda.</p>';
      return;
    }
    el.innerHTML = rows.map((r) => `
      <div class="hist-row">
        <div class="hist-info">
          <div class="hist-receipt">${esc(r.receipt_no)}</div>
          <div class="hist-meta">
            ${fmtDT(r.created_at)} · Executado por ${esc(r.performed_by || '—')} · ${r.item_count} registro(s)
            ${r.subject_name ? ' · Titular: ' + esc(r.subject_name) : ''}
            ${r.reason ? ' · Motivo: ' + esc(r.reason) : ''}
          </div>
          ${(r.summary || []).length ? `<div class="hist-items">${r.summary.map((s) => `<div class="hist-item">${esc(s)}</div>`).join('')}</div>` : ''}
        </div>
        <button class="btn btn-ghost btn-sm" onclick="downloadReceipt(${r.id}, '${esc(r.receipt_no)}')">⬇ PDF</button>
      </div>
    `).join('');
  } catch {
    el.innerHTML = '<p class="muted">Não foi possível carregar o histórico.</p>';
  }
}

// ── Eventos ──────────────────────────────────────────────────────────────────
document.getElementById('eraseSearchBtn').addEventListener('click', runSearch);
document.getElementById('eraseSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });
document.getElementById('eraseBtn').addEventListener('click', runErase);

loadErasures();
