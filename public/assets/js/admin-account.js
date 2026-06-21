requireSession();
mountShell('account');

const ROLE_TXT = { admin: 'Administrador', gestor: 'Gestor de Eventos', operador: 'Operador' };

async function loadMe() {
  const { admin } = await Api.get('/api/auth/me');
  document.getElementById('pf_name').value = admin.name || '';
  document.getElementById('pf_email').value = admin.email || '';
  const role = admin.role === 'editor' ? 'gestor' : admin.role;
  document.getElementById('roleLine').textContent = `Perfil: ${ROLE_TXT[role] || 'Operador'}`;
}

// ---- Salvar dados do perfil ----
document.getElementById('pf_save').addEventListener('click', async () => {
  const err = document.getElementById('pf_err'); err.classList.add('hidden');
  const name = document.getElementById('pf_name').value.trim();
  const email = document.getElementById('pf_email').value.trim();
  if (!name) { err.textContent = 'Informe seu nome.'; err.classList.remove('hidden'); return; }
  const btn = document.getElementById('pf_save'); btn.disabled = true;
  try {
    const r = await Api.put('/api/auth/profile', { name, email });
    if (r.token) Api.setToken(r.token); // atualiza o token (nome/e-mail no menu lateral)
    toast('Dados atualizados.');
    mountShell('account'); // re-renderiza a barra lateral com o novo nome
  } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
  finally { btn.disabled = false; }
});

// ---- Alterar senha ----
document.getElementById('pw_save').addEventListener('click', async () => {
  const err = document.getElementById('pw_err'); err.classList.add('hidden');
  const cur = document.getElementById('pw_cur').value;
  const nw = document.getElementById('pw_new').value;
  const nw2 = document.getElementById('pw_new2').value;
  const fail = (m) => { err.textContent = m; err.classList.remove('hidden'); };
  if (!cur || !nw) return fail('Preencha a senha atual e a nova senha.');
  if (nw.length < 8) return fail('A nova senha deve ter ao menos 8 caracteres.');
  if (nw !== nw2) return fail('A confirmação não corresponde à nova senha.');
  const btn = document.getElementById('pw_save'); btn.disabled = true;
  try {
    await Api.post('/api/auth/password', { current_password: cur, new_password: nw });
    document.getElementById('pw_cur').value = '';
    document.getElementById('pw_new').value = '';
    document.getElementById('pw_new2').value = '';
    toast('Senha alterada com sucesso.');
  } catch (e) { fail(e.message); }
  finally { btn.disabled = false; }
});

// ---- Aparelhos conectados ----
// Transforma o "user agent" (texto técnico do navegador) num rótulo amigável.
function deviceLabel(ua) {
  ua = ua || '';
  let os = 'Dispositivo';
  if (/iPhone|iPad|iPod/i.test(ua)) os = 'iPhone/iPad';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Macintosh|Mac OS X/i.test(ua)) os = 'Mac';
  else if (/Linux/i.test(ua)) os = 'Linux';
  let br = '';
  if (/Edg\//i.test(ua)) br = 'Edge';
  else if (/Chrome\//i.test(ua)) br = 'Chrome';
  else if (/Firefox\//i.test(ua)) br = 'Firefox';
  else if (/Safari\//i.test(ua)) br = 'Safari';
  return br ? `${os} · ${br}` : os;
}

async function loadSessions() {
  const box = document.getElementById('sess_list');
  const revokeBtn = document.getElementById('sess_revoke');
  try {
    const r = await fetch('/api/auth/sessions', {
      headers: { Authorization: `Bearer ${Api.token()}`, 'X-Refresh-Token': Api.refreshToken() || '' },
    });
    if (!r.ok) throw new Error();
    const { sessions } = await r.json();
    if (!sessions || !sessions.length) {
      box.innerHTML = '<p class="muted" style="font-size:13px">Nenhuma sessão ativa.</p>';
      revokeBtn.style.display = 'none';
      return;
    }
    box.innerHTML = sessions.map((s) => `
      <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--gray-soft)">
        <span style="font-size:18px">${s.current ? '📱' : '💻'}</span>
        <span style="flex:1;min-width:0">
          <strong style="font-size:14px">${esc(deviceLabel(s.user_agent))}${s.current ? ' <span style="color:var(--cyan);font-weight:600">(este aparelho)</span>' : ''}</strong>
          <span class="muted" style="display:block;font-size:12px">${s.city ? '📍 ' + esc(s.city) + ' · ' : ''}Última atividade: ${fmtDateTimeBR(s.last_used_at)}</span>
        </span>
        ${s.current ? '' : `<button class="btn btn-ghost btn-sm sess-remove" data-id="${s.id}" title="Remover este aparelho">Remover</button>`}
      </div>`).join('');
    // "Remover" individual de cada aparelho (exceto o atual).
    box.querySelectorAll('.sess-remove').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Remover este aparelho?')) return;
      b.disabled = true;
      try {
        const rr = await fetch(`/api/auth/sessions/${b.getAttribute('data-id')}/revoke`, {
          method: 'POST', headers: { Authorization: `Bearer ${Api.token()}` },
        });
        if (!rr.ok) throw new Error();
        toast('Aparelho removido.');
        loadSessions();
      } catch { toast('Não foi possível remover agora.'); b.disabled = false; }
    }));
    revokeBtn.style.display = sessions.length > 1 ? '' : 'none';
  } catch {
    box.innerHTML = '<p class="muted" style="font-size:13px">Não foi possível carregar agora.</p>';
    revokeBtn.style.display = 'none';
  }
}

document.getElementById('sess_revoke').addEventListener('click', async () => {
  if (!confirm('Desconectar todos os outros aparelhos agora? Este aparelho continua conectado.')) return;
  const btn = document.getElementById('sess_revoke'); btn.disabled = true;
  try {
    const r = await fetch('/api/auth/sessions/revoke-others', {
      method: 'POST',
      headers: { Authorization: `Bearer ${Api.token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: Api.refreshToken() }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Falha ao desconectar.');
    if (d.token) Api.setToken(d.token); // mantém este aparelho válido após a invalidação
    toast('Outros aparelhos desconectados.');
    loadSessions();
  } catch (e) { toast(e.message); }
  finally { btn.disabled = false; }
});

loadMe().catch((e) => toast(e.message));
loadSessions();
