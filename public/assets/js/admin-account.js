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

loadMe().catch((e) => toast(e.message));
