// Página pública de RSVP — lê o slug a partir da URL /rsvp/:slug
const slug = location.pathname.split('/').filter(Boolean).pop();
const root = document.getElementById('root');
let EVENT = null;
let choice = null;

const ICON = {
  cal: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  clock: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  pin: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-5.7-7-11a7 7 0 0 1 14 0c0 5.3-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
};

async function load() {
  try {
    EVENT = await fetch(`/api/public/events/${slug}`).then((r) => { if (!r.ok) throw new Error('404'); return r.json(); });
  } catch {
    root.innerHTML = `<div class="rsvp-card closed-box"><h2>Evento não encontrado</h2><p class="muted">Verifique o link recebido.</p></div>`;
    return;
  }
  render();
}

function metaRow(icon, text) { return text ? `<div class="m">${icon}<span>${esc(text)}</span></div>` : ''; }

function render() {
  const e = EVENT;
  const cover = e.cover_image
    ? `<div class="rsvp-cover" style="background-image:url('${e.cover_image}')"></div>` : '';
  const clientLogo = e.client_logo ? `<img class="client-logo" src="${e.client_logo}" alt="" />` : '';
  const dateTxt = e.event_date ? fmtDateBR(e.event_date) : '';

  const header = `
    ${cover}
    <div class="rsvp-card">
      ${clientLogo}
      <div class="eyebrow">Confirmação de presença</div>
      <h1>${esc(e.name)}</h1>
      <div class="event-meta">
        ${metaRow(ICON.cal, dateTxt)}
        ${metaRow(ICON.clock, e.event_time)}
        ${metaRow(ICON.pin, e.location)}
      </div>
      ${e.description ? `<p class="event-desc">${esc(e.description)}</p>` : ''}
      <div id="form-slot"></div>
    </div>`;
  root.innerHTML = header;

  if (e.closed) {
    document.getElementById('form-slot').innerHTML = `
      <div class="divider"></div>
      <div class="closed-box">
        <h2>Confirmações encerradas</h2>
        <p class="muted">${e.closed_reason === 'prazo'
          ? 'O prazo para confirmar presença foi encerrado.'
          : 'Este evento não está recebendo confirmações no momento.'}</p>
      </div>`;
    return;
  }
  renderForm();
}

function optField(key, cfg) {
  if (!cfg.enabled) return '';
  const types = { email: 'email', phone: 'tel' };
  return `<div class="field">
    <label>${esc(cfg.label)} ${cfg.required ? '<span class="req">*</span>' : ''}</label>
    <input type="${types[key] || 'text'}" name="${key}" ${cfg.required ? 'required' : ''} />
  </div>`;
}

function renderForm() {
  const fc = EVENT.form_config || {};
  document.getElementById('form-slot').innerHTML = `
    <div class="divider"></div>
    <div class="field">
      <label>Nome completo <span class="req">*</span></label>
      <input type="text" name="name" required autocomplete="name" />
    </div>
    ${optField('company', fc.company)}
    ${optField('role', fc.role)}
    ${optField('email', fc.email)}
    ${optField('phone', fc.phone)}

    <div class="divider"></div>
    <p class="choice-q">Você participará deste evento?</p>
    <div class="choices">
      <label class="choice" id="ch-yes">
        <input type="radio" name="response" value="confirmado" />
        <span>Sim, confirmo minha presença</span>
      </label>
      <label class="choice" id="ch-no">
        <input type="radio" name="response" value="recusado" />
        <span>Não poderei comparecer</span>
      </label>
    </div>
    <p class="error-msg hidden" id="err"></p>
    <button class="btn btn-primary" id="submit" style="width:100%;margin-top:18px">Enviar resposta</button>`;

  const yes = document.getElementById('ch-yes');
  const no = document.getElementById('ch-no');
  yes.querySelector('input').addEventListener('change', () => { choice = 'confirmado'; yes.classList.add('sel-yes'); no.classList.remove('sel-no'); });
  no.querySelector('input').addEventListener('change', () => { choice = 'recusado'; no.classList.add('sel-no'); yes.classList.remove('sel-yes'); });
  document.getElementById('submit').addEventListener('click', submit);
}

async function submit() {
  const err = document.getElementById('err');
  err.classList.add('hidden');
  const get = (n) => (document.querySelector(`[name="${n}"]`)?.value || '').trim();
  const body = { name: get('name'), company: get('company'), role: get('role'), email: get('email'), phone: get('phone'), response: choice };

  if (!body.name) return showErr('Por favor, informe seu nome completo.');
  if (!body.response) return showErr('Selecione se você participará ou não do evento.');
  const fc = EVENT.form_config || {};
  for (const k of ['company', 'role', 'email', 'phone']) {
    if (fc[k]?.enabled && fc[k]?.required && !body[k]) return showErr(`O campo "${fc[k].label}" é obrigatório.`);
  }

  const btn = document.getElementById('submit');
  btn.disabled = true; btn.textContent = 'Enviando…';
  try {
    const r = await fetch(`/api/public/events/${slug}/rsvp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then((x) => x.json().then((d) => { if (!x.ok) throw new Error(d.error); return d; }));
    showResult(r);
  } catch (e2) {
    btn.disabled = false; btn.textContent = 'Enviar resposta';
    showErr(e2.message);
  }
}
function showErr(m) { const err = document.getElementById('err'); err.textContent = m; err.classList.remove('hidden'); }

function showResult(r) {
  const ok = r.response === 'confirmado';
  const check = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>';
  const cross = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  document.getElementById('form-slot').innerHTML = `
    <div class="divider"></div>
    <div class="result">
      <div class="badge ${ok ? 'ok' : 'no'}">${ok ? check : cross}</div>
      <h2>${ok ? 'Presença confirmada' : 'Resposta registrada'}</h2>
      <p>${esc(r.message)}</p>
      ${r.updated ? '' : `<div class="note">Precisa alterar sua resposta? Basta acessar este mesmo link novamente e reenviar — seus dados serão atualizados.</div>`}
      <button class="btn btn-ghost btn-sm" style="margin-top:18px" onclick="location.reload()">Enviar nova resposta</button>
    </div>`;
}

load();
