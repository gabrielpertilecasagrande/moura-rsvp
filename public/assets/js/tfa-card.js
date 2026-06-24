// Card "Verificação em duas etapas" (2FA) da tela de conta. Reutilizável nos 3
// sistemas: depende apenas de Api, esc e toast (todos em api.js) e dos elementos
// #tfa_status e #tfa_toggle no HTML. As rotas /api/auth/2fa/* são iguais nos três
// backends. O modal é próprio (não depende de openModal) usando as classes
// .modal-bg/.modal já presentes no CSS dos três sistemas.
(function initTfaCard() {
  const statusEl = document.getElementById('tfa_status');
  const toggleEl = document.getElementById('tfa_toggle');
  if (!statusEl || !toggleEl) return; // página sem o card

  // Modal autossuficiente (injeta em #modalSlot; cria se não existir).
  function openModal(innerHtml, maxWidth) {
    let slot = document.getElementById('modalSlot');
    if (!slot) { slot = document.createElement('div'); slot.id = 'modalSlot'; document.body.appendChild(slot); }
    slot.innerHTML = `<div class="modal-bg"><div class="modal" style="max-width:${maxWidth || 460}px;text-align:left">${innerHtml}</div></div>`;
    const bg = slot.querySelector('.modal-bg');
    const close = () => { slot.innerHTML = ''; };
    bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
    const first = slot.querySelector('input');
    if (first) setTimeout(() => first.focus(), 30);
    return { root: slot.querySelector('.modal'), close };
  }

  async function load() {
    try {
      const s = await Api.get('/api/auth/2fa/status');
      if (s.enabled) {
        const rest = (s.recovery_remaining != null) ? ` · ${s.recovery_remaining} código(s) de recuperação restante(s)` : '';
        statusEl.innerHTML = '✅ <strong>Ativada</strong>' + rest;
        toggleEl.textContent = 'Desativar';
        toggleEl.className = 'btn btn-ghost btn-sm';
        toggleEl.style.color = 'var(--danger)';
        toggleEl.disabled = false;
      } else {
        const warn = s.encryption_ready ? '' : ' · <span style="color:var(--danger)">indisponível: chave de criptografia não configurada no servidor</span>';
        statusEl.innerHTML = '⚪ <strong>Desativada</strong>' + warn;
        toggleEl.textContent = 'Ativar verificação em duas etapas';
        toggleEl.className = 'btn btn-primary btn-sm';
        toggleEl.style.color = '';
        toggleEl.disabled = !s.encryption_ready;
      }
      toggleEl.style.display = '';
      toggleEl.dataset.enabled = s.enabled ? '1' : '0';
    } catch (e) {
      statusEl.textContent = 'Não foi possível carregar.';
    }
  }

  async function startSetup() {
    let data;
    try { data = await Api.post('/api/auth/2fa/setup'); }
    catch (e) { toast(e.message); return; }
    const { root, close } = openModal(`
      <h2 style="margin-bottom:8px">Ativar verificação em duas etapas</h2>
      <p style="font-size:13.5px;color:var(--muted);margin:0 0 14px"><strong>1.</strong> Abra seu app autenticador (Google Authenticator, Authy…) e escaneie o QR Code abaixo. <strong>2.</strong> Digite o código de 6 dígitos que aparecer no app.</p>
      <div style="text-align:center;margin-bottom:12px"><img src="${data.qr}" alt="QR Code" style="width:200px;height:200px;border-radius:8px" /></div>
      <p style="font-size:12px;color:var(--muted);text-align:center;margin:0 0 14px">Não consegue escanear? Digite esta chave manualmente no app:<br><code style="font-size:13px;word-break:break-all">${esc(data.secret)}</code></p>
      <div class="field"><label>Código de 6 dígitos</label><input type="text" id="tfa_code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" /></div>
      <p class="error-msg hidden" id="tfa_setup_err"></p>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-ghost" data-act="cancel">Cancelar</button>
        <button class="btn btn-primary" id="tfa_confirm">Confirmar e ativar</button>
      </div>`, 460);
    root.querySelector('[data-act="cancel"]').addEventListener('click', close);
    root.querySelector('#tfa_confirm').addEventListener('click', async () => {
      const err = root.querySelector('#tfa_setup_err'); err.classList.add('hidden');
      const code = root.querySelector('#tfa_code').value.trim();
      const btn = root.querySelector('#tfa_confirm'); btn.disabled = true;
      try {
        const r = await Api.post('/api/auth/2fa/enable', { code });
        close();
        showRecoveryCodes(r.recovery_codes);
      } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); btn.disabled = false; }
    });
  }

  function showRecoveryCodes(codes) {
    const list = (codes || []).map((c) => `<code style="display:block;font-size:15px;letter-spacing:1px;padding:4px 0">${esc(c)}</code>`).join('');
    const { root, close } = openModal(`
      <h2 style="margin-bottom:8px">✅ Verificação ativada!</h2>
      <p style="font-size:13.5px;color:var(--muted);margin:0 0 12px">Guarde estes <strong>códigos de recuperação</strong> em local seguro. Cada um funciona <strong>uma única vez</strong> caso você perca o acesso ao app autenticador. <strong>Eles não serão mostrados de novo.</strong></p>
      <div style="background:var(--gray-soft);border-radius:10px;padding:14px 16px;text-align:center;margin-bottom:14px">${list}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-ghost" id="tfa_copy">Copiar</button>
        <button class="btn btn-ghost" id="tfa_download">Baixar .txt</button>
        <button class="btn btn-primary" data-act="done">Concluir</button>
      </div>`, 440);
    root.querySelector('#tfa_copy').addEventListener('click', () => {
      const txt = (codes || []).join('\n');
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => toast('Códigos copiados.')).catch(() => toast('Copie manualmente.'));
      else toast('Copie manualmente.');
    });
    root.querySelector('#tfa_download').addEventListener('click', () => {
      const blob = new Blob([(codes || []).join('\n') + '\n'], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'codigos-recuperacao.txt';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });
    root.querySelector('[data-act="done"]').addEventListener('click', () => { close(); load(); });
  }

  async function startDisable() {
    const { root, close } = openModal(`
      <h2 style="margin-bottom:8px">Desativar verificação em duas etapas</h2>
      <p style="font-size:13.5px;color:var(--muted);margin:0 0 14px">Para desativar, confirme sua senha e um código do app (ou um código de recuperação).</p>
      <div class="field"><label>Senha atual</label><input type="password" id="tfa_pw" autocomplete="current-password" /></div>
      <div class="field"><label>Código (6 dígitos ou de recuperação)</label><input type="text" id="tfa_dcode" autocomplete="one-time-code" /></div>
      <p class="error-msg hidden" id="tfa_dis_err"></p>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-ghost" data-act="cancel">Cancelar</button>
        <button class="btn btn-primary" id="tfa_dis_confirm" style="background:var(--danger);border-color:var(--danger)">Desativar</button>
      </div>`, 440);
    root.querySelector('[data-act="cancel"]').addEventListener('click', close);
    root.querySelector('#tfa_dis_confirm').addEventListener('click', async () => {
      const err = root.querySelector('#tfa_dis_err'); err.classList.add('hidden');
      const btn = root.querySelector('#tfa_dis_confirm'); btn.disabled = true;
      try {
        await Api.post('/api/auth/2fa/disable', {
          password: root.querySelector('#tfa_pw').value,
          code: root.querySelector('#tfa_dcode').value.trim(),
        });
        close(); toast('Verificação em duas etapas desativada.'); load();
      } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); btn.disabled = false; }
    });
  }

  toggleEl.addEventListener('click', () => {
    if (toggleEl.dataset.enabled === '1') startDisable();
    else startSetup();
  });

  load();
})();
