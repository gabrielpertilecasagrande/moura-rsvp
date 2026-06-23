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

// Monta o link wa.me a partir do número informado no evento.
function whatsappHref() {
  if (!EVENT || !EVENT.whatsapp) return null;
  let digits = String(EVENT.whatsapp).replace(/\D/g, '');
  if (!digits) return null;
  // Adiciona o código do Brasil (55) quando vier só com DDD + número (10 ou 11 dígitos).
  if (digits.length <= 11 && !digits.startsWith('55')) digits = '55' + digits;
  return `https://wa.me/${digits}`;
}
const WA_ICON = '<img src="/assets/img/whatsapp.png" alt="WhatsApp" width="22" height="22" style="display:block" />';
function whatsappButton(label) {
  const href = whatsappHref();
  if (!href) return '';
  return `<a class="btn-whatsapp" href="${href}" target="_blank" rel="noopener">${WA_ICON}<span>${label}</span></a>`;
}

// Contagem regressiva: retorna o HTML do bloco ou string vazia se o evento já passou.
let countdownTimer = null;
function buildCountdown(e) {
  if (!e.event_date) return '';
  const datePart = e.event_date; // YYYY-MM-DD
  const timePart = e.event_time || '00:00';
  const eventMs = new Date(`${datePart}T${timePart}`).getTime();
  if (isNaN(eventMs) || eventMs <= Date.now()) return '';
  return '<div id="countdown" class="rsvp-countdown"></div>';
}

function startCountdown(e) {
  const el = document.getElementById('countdown');
  if (!el) return;
  const datePart = e.event_date;
  const timePart = e.event_time || '00:00';
  const eventMs = new Date(`${datePart}T${timePart}`).getTime();

  function tick() {
    const diff = eventMs - Date.now();
    if (diff <= 0) { el.remove(); clearInterval(countdownTimer); return; }
    const totalSec = Math.floor(diff / 1000);
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const warn = d === 0;
    const pad = (n) => String(n).padStart(2, '0');
    let parts = '';
    if (d > 0) parts += `<span class="cd-unit"><strong>${d}</strong><em>d</em></span>`;
    parts += `<span class="cd-unit"><strong>${pad(h)}</strong><em>h</em></span>`;
    parts += `<span class="cd-unit"><strong>${pad(m)}</strong><em>m</em></span>`;
    parts += `<span class="cd-unit"><strong>${pad(s)}</strong><em>s</em></span>`;
    el.className = `rsvp-countdown${warn ? ' rsvp-countdown-warn' : ''}`;
    el.innerHTML = `<span class="cd-label">Faltam</span>${parts}`;
  }
  tick();
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(tick, 1000);
}

// Botões de ação: Google Agenda e Abrir no mapa.
function buildActionButtons(e) {
  const buttons = [];

  if (e.event_date) {
    const datePart = e.event_date.replace(/-/g, '');
    const startTime = e.event_time ? e.event_time.replace(':', '') + '00' : '000000';
    const gcStart = `${datePart}T${startTime}`;
    // Usa apenas a data de início; sem hora de término definida, repete o mesmo dia.
    const gcDates = `${gcStart}/${gcStart}`;
    const gcParams = new URLSearchParams({
      action: 'TEMPLATE',
      text: e.name || '',
      dates: gcDates,
      details: e.description || '',
      location: [e.address, e.location, e.city].filter(Boolean).join(', '),
    });
    const gcUrl = `https://calendar.google.com/calendar/render?${gcParams.toString()}`;
    buttons.push(`<a class="btn-action" href="${gcUrl}" target="_blank" rel="noopener">Adicionar ao Google Agenda</a>`);
  }

  const mapQuery = [e.address, e.location, e.city].filter(Boolean).join(' ');
  if (mapQuery) {
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`;
    buttons.push(`<a class="btn-action" href="${mapsUrl}" target="_blank" rel="noopener">Abrir no mapa</a>`);
  }

  if (!buttons.length) return '';
  return `<div class="rsvp-actions">${buttons.join('')}</div>`;
}

function render() {
  if (EVENT.landing_enabled) { renderLanding(); return; }

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
        ${metaRow(ICON.pin, [e.location, e.city].filter(Boolean).join(' · '))}
      </div>
      ${e.description ? `<p class="event-desc">${esc(e.description)}</p>` : ''}
      ${buildCountdown(e)}
      ${buildActionButtons(e)}
      <div id="form-slot"></div>
    </div>`;
  root.innerHTML = header;

  startCountdown(e);

  if (e.closed) {
    document.getElementById('form-slot').innerHTML = `
      <div class="divider"></div>
      <div class="closed-box">
        <h2>Confirmações encerradas</h2>
        <p class="muted">${e.closed_reason === 'prazo'
          ? 'O prazo para confirmar presença foi encerrado.'
          : 'Este evento não está recebendo confirmações no momento.'}</p>
        ${whatsappButton('Falar com a organização')}
      </div>`;
    return;
  }
  renderForm();
}

// ---- Landing Page Premium ----

function toEmbedUrl(url) {
  if (!url) return null;
  const u = url.trim();
  const yt = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vimeo = u.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  if (/youtube\.com\/embed\/|player\.vimeo\.com\//.test(u)) return u;
  return null;
}

function lpMetaItem(icon, text) {
  if (!text) return '';
  return `<div class="lp-hero-meta-item">${icon}<span>${esc(text)}</span></div>`;
}

function renderLanding() {
  const e = EVENT;
  const lc = e.landing_config || { sections: [] };
  const sections = Array.isArray(lc.sections) ? lc.sections : [];
  const byType = {};
  sections.forEach((s) => { byType[s.type] = s; });

  document.body.classList.add('lp-body');

  const heroBg = e.cover_image ? `style="background-image:url('${e.cover_image}')"` : '';
  const dateTxt = e.event_date ? fmtDateBR(e.event_date) : '';
  const locationTxt = [e.location, e.city].filter(Boolean).join(' · ');

  root.innerHTML = `
    <div class="lp-page">
      <section class="lp-hero" ${heroBg}>
        <div class="lp-hero-inner">
          ${e.client_logo ? `<img class="lp-hero-logo" src="${e.client_logo}" alt="" />` : ''}
          <div class="lp-hero-eyebrow">Confirmação de presença</div>
          <h1 class="lp-hero-title">${esc(e.name)}</h1>
          <div class="lp-hero-meta">
            ${lpMetaItem(ICON.cal, dateTxt)}
            ${lpMetaItem(ICON.clock, e.event_time)}
            ${lpMetaItem(ICON.pin, locationTxt)}
          </div>
          <a href="#lp-rsvp" class="lp-hero-cta">Confirmar Presença</a>
        </div>
      </section>

      <div class="lp-sections">
        <section class="lp-section" id="lp-rsvp">
          <div class="lp-rsvp-card">
            ${e.description ? `<p class="lp-rsvp-desc">${esc(e.description)}</p>` : ''}
            <div id="form-slot"></div>
          </div>
        </section>
        ${renderLpSections(byType)}
      </div>

      <footer class="lp-footer rsvp-footer">
        <img class="footer-logo" src="/assets/img/logo-moura.png" alt="Moura" />
        <div class="footer-title">Plataforma de Confirmação de Presença</div>
        <div class="footer-links">
          <a href="/legal.html#privacy" target="_blank" rel="noopener">Política de Privacidade</a> ·
          <a href="/legal.html#terms" target="_blank" rel="noopener">Termos de Uso</a>
        </div>
      </footer>
    </div>`;

  if (e.closed) {
    document.getElementById('form-slot').innerHTML = `
      <div class="divider"></div>
      <div class="closed-box">
        <h2>Confirmações encerradas</h2>
        <p class="muted">${e.closed_reason === 'prazo'
          ? 'O prazo para confirmar presença foi encerrado.'
          : 'Este evento não está recebendo confirmações no momento.'}</p>
        ${whatsappButton('Falar com a organização')}
      </div>`;
    return;
  }
  renderForm();
  initFaq();
}

function renderLpSections(byType) {
  const order = ['video', 'agenda', 'location', 'sponsors', 'faq'];
  return order.map((type) => {
    const sec = byType[type];
    if (!sec || !sec.enabled) return '';
    const title = sec.title ? `<h2 class="lp-section-title">${esc(sec.title)}</h2>` : '';
    if (type === 'video') {
      const embed = toEmbedUrl(sec.url);
      if (!embed) return '';
      return `<section class="lp-section">${title}
        <div class="lp-video-wrap"><iframe src="${esc(embed)}" allowfullscreen loading="lazy"></iframe></div>
      </section>`;
    }
    if (type === 'agenda') {
      const items = (sec.items || []).filter((it) => it.title);
      if (!items.length) return '';
      const rows = items.map((it) => `
        <div class="lp-timeline-item">
          <span class="lp-timeline-time">${esc(it.time || '')}</span>
          <div class="lp-timeline-dot"></div>
          <div class="lp-timeline-body">
            <strong>${esc(it.title)}</strong>
            ${it.description ? `<p>${esc(it.description)}</p>` : ''}
          </div>
        </div>`).join('');
      return `<section class="lp-section">${title}<div class="lp-timeline">${rows}</div></section>`;
    }
    if (type === 'location') {
      if (!sec.embed_url) return '';
      return `<section class="lp-section">${title}
        <div class="lp-map-wrap"><iframe src="${esc(sec.embed_url)}" allowfullscreen loading="lazy"></iframe></div>
      </section>`;
    }
    if (type === 'sponsors') {
      const items = (sec.items || []).filter((it) => it.name || it.logo_url);
      if (!items.length) return '';
      const cards = items.map((it) => {
        const inner = it.logo_url
          ? `<img src="${esc(it.logo_url)}" alt="${esc(it.name)}" />`
          : `<span class="lp-sponsor-name">${esc(it.name)}</span>`;
        return it.website
          ? `<a class="lp-sponsor-card" href="${esc(it.website)}" target="_blank" rel="noopener">${inner}${it.logo_url && it.name ? `<span class="lp-sponsor-name">${esc(it.name)}</span>` : ''}</a>`
          : `<div class="lp-sponsor-card">${inner}</div>`;
      }).join('');
      return `<section class="lp-section">${title}<div class="lp-sponsors-grid">${cards}</div></section>`;
    }
    if (type === 'faq') {
      const items = (sec.items || []).filter((it) => it.question);
      if (!items.length) return '';
      const chevron = '<svg class="lp-faq-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg>';
      const rows = items.map((it, i) => `
        <div class="lp-faq-item" data-faq="${i}">
          <div class="lp-faq-q">${esc(it.question)}${chevron}</div>
          <div class="lp-faq-a">${esc(it.answer || '')}</div>
        </div>`).join('');
      return `<section class="lp-section">${title}<div class="lp-faq">${rows}</div></section>`;
    }
    return '';
  }).join('');
}

function initFaq() {
  document.querySelectorAll('.lp-faq-q').forEach((q) => {
    q.addEventListener('click', () => q.closest('.lp-faq-item').classList.toggle('open'));
  });
}

// Renderiza um campo configurável (builtin → name=chave; personalizado → data-ckey*).
function optField(f) {
  if (!f.enabled) return '';
  const builtinTypes = { email: 'email', phone: 'tel' };
  const req = f.required ? '<span class="req">*</span>' : '';
  const label = `<label>${esc(f.label)} ${req}</label>`;
  if (f.builtin) {
    return `<div class="field">${label}
      <input type="${builtinTypes[f.key] || 'text'}" name="${f.key}" ${f.required ? 'required' : ''} />
    </div>`;
  }
  const key = esc(f.key);
  const opts = f.options || [];
  let control;
  switch (f.type) {
    case 'textarea':
      control = `<textarea data-ckey="${key}" ${f.required ? 'required' : ''}></textarea>`; break;
    case 'number':
      control = `<input type="number" data-ckey="${key}" ${f.required ? 'required' : ''} />`; break;
    case 'date':
      control = `<input type="date" data-ckey="${key}" ${f.required ? 'required' : ''} />`; break;
    case 'select':
      control = `<select data-ckey="${key}" ${f.required ? 'required' : ''}>
        <option value="">Selecione…</option>
        ${opts.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}
      </select>`; break;
    case 'radio':
      control = `<div class="opt-group">${opts.map((o, k) => `
        <label class="opt"><input type="radio" name="ck_${key}" data-ckeyradio="${key}" value="${esc(o)}" ${f.required && k === 0 ? '' : ''} /> ${esc(o)}</label>`).join('')}</div>`; break;
    case 'boolean':
      control = `<div class="opt-group">
        <label class="opt"><input type="radio" name="ck_${key}" data-ckeyradio="${key}" value="Sim" /> Sim</label>
        <label class="opt"><input type="radio" name="ck_${key}" data-ckeyradio="${key}" value="Não" /> Não</label>
      </div>`; break;
    case 'checkbox':
      control = `<div class="opt-group">${opts.map((o) => `
        <label class="opt"><input type="checkbox" data-ckeymulti="${key}" value="${esc(o)}" /> ${esc(o)}</label>`).join('')}</div>`; break;
    default:
      control = `<input type="text" data-ckey="${key}" ${f.required ? 'required' : ''} />`;
  }

  // Campo de nome do acompanhante: começa oculto, revelado pelo campo c_acomp_vem.
  if (f.key === 'c_acomp_nome') {
    return `<div class="field" id="field-acomp-nome" style="display:none">${label}${control}</div>`;
  }

  return `<div class="field">${label}${control}</div>`;
}

// Lê o valor de um campo personalizado conforme o tipo (string ou array).
function getCustomValue(f) {
  if (f.type === 'checkbox') {
    return [...document.querySelectorAll(`[data-ckeymulti="${CSS.escape(f.key)}"]:checked`)].map((x) => x.value);
  }
  if (f.type === 'radio' || f.type === 'boolean') {
    const el = document.querySelector(`[data-ckeyradio="${CSS.escape(f.key)}"]:checked`);
    return el ? el.value : '';
  }
  const el = document.querySelector(`[data-ckey="${CSS.escape(f.key)}"]`);
  return el ? el.value.trim() : '';
}

function renderForm() {
  const fc = EVENT.form_config || { fields: [] };
  const fieldsHtml = (fc.fields || []).map(optField).join('');
  document.getElementById('form-slot').innerHTML = `
    <div class="divider"></div>
    <div class="field">
      <label>Nome completo <span class="req">*</span></label>
      <input type="text" name="name" required autocomplete="name" placeholder="Nome e sobrenome" />
    </div>
    <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0" />
    ${fieldsHtml}

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
    <div class="divider"></div>
    <div class="consent-box">
      <label class="consent-item">
        <input type="checkbox" id="cs-terms" />
        <span>Li e concordo com os <a href="/legal.html#terms" target="_blank" rel="noopener">Termos de Uso</a>.</span>
      </label>
      <label class="consent-item">
        <input type="checkbox" id="cs-privacy" />
        <span>Li e concordo com a <a href="/legal.html#privacy" target="_blank" rel="noopener">Política de Privacidade</a>.</span>
      </label>
      <label class="consent-item">
        <input type="checkbox" id="cs-data" />
        <span>Autorizo o tratamento dos meus dados pessoais para fins de organização do evento, credenciamento, comunicação e execução dos serviços, conforme a LGPD.</span>
      </label>
    </div>
    <p class="error-msg hidden" id="err"></p>
    <button class="btn btn-primary" id="submit" style="width:100%;margin-top:18px">Enviar resposta</button>
    ${whatsappButton('Falar com a organização')}`;

  const yes = document.getElementById('ch-yes');
  const no = document.getElementById('ch-no');
  yes.querySelector('input').addEventListener('change', () => { choice = 'confirmado'; yes.classList.add('sel-yes'); no.classList.remove('sel-no'); });
  no.querySelector('input').addEventListener('change', () => { choice = 'recusado'; no.classList.add('sel-no'); yes.classList.remove('sel-yes'); });
  document.getElementById('submit').addEventListener('click', submit);

  // Mostrar/ocultar o campo de nome do acompanhante conforme a resposta de c_acomp_vem.
  const acompVemRadios = document.querySelectorAll('[data-ckeyradio="c_acomp_vem"]');
  if (acompVemRadios.length) {
    acompVemRadios.forEach((radio) => {
      radio.addEventListener('change', () => {
        const nomeField = document.getElementById('field-acomp-nome');
        if (!nomeField) return;
        const sim = radio.value === 'Sim' && radio.checked;
        nomeField.style.display = sim ? '' : 'none';
        if (!sim) {
          const nomeInput = nomeField.querySelector('[data-ckey="c_acomp_nome"]');
          if (nomeInput) nomeInput.value = '';
        }
      });
    });
  }
}

async function submit() {
  const err = document.getElementById('err');
  err.classList.add('hidden');
  const get = (n) => (document.querySelector(`[name="${n}"]`)?.value || '').trim();
  const checked = (id) => !!document.getElementById(id)?.checked;
  const body = { name: get('name'), company: get('company'), role: get('role'), email: get('email'), phone: get('phone'), response: choice, website: get('website'),
    accepted_terms: checked('cs-terms'), accepted_privacy_policy: checked('cs-privacy'), accepted_data_processing: checked('cs-data') };

  // Respostas dos campos personalizados.
  const fc = EVENT.form_config || { fields: [] };
  const extra = {};
  (fc.fields || []).forEach((f) => { if (f.enabled && !f.builtin) extra[f.key] = getCustomValue(f); });
  body.extra = extra;

  const filled = (v) => (Array.isArray(v) ? v.length > 0 : !!String(v || '').trim());
  if (!body.name) return showErr('Por favor, informe seu nome.');
  // Aceita nomes de uma palavra (mononímicos/estrangeiros). Exige só que tenha
  // sentido (ao menos 2 letras) — não obriga sobrenome.
  if (body.name.replace(/[^\p{L}]/gu, '').length < 2) return showErr('Por favor, informe seu nome.');
  if (!body.response) return showErr('Selecione se você participará ou não do evento.');
  if (!body.accepted_terms || !body.accepted_privacy_policy || !body.accepted_data_processing) {
    return showErr('Para enviar, é necessário aceitar os Termos, a Política de Privacidade e autorizar o tratamento dos dados.');
  }
  for (const f of (fc.fields || [])) {
    if (!f.enabled || !f.required) continue;
    // Ignora validação de c_acomp_nome se c_acomp_vem for "Não" ou não respondido.
    if (f.key === 'c_acomp_nome') {
      const vem = extra['c_acomp_vem'];
      if (vem !== 'Sim') continue;
    }
    const val = f.builtin ? body[f.key] : extra[f.key];
    if (!filled(val)) return showErr(`O campo "${f.label}" é obrigatório.`);
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
  // Código de entrada (QR): exibido apenas para quem confirmou presença.
  const qr = (ok && r.qr_token) ? `
      <div class="entry-qr" style="margin-top:22px;padding-top:18px;border-top:1px solid rgba(0,0,0,.08)">
        <p style="font-weight:600;margin:0 0 4px">Seu código de entrada</p>
        <p class="muted" style="margin:0 0 12px;font-size:14px">Apresente este QR Code na recepção do evento para agilizar seu check-in.</p>
        <img src="/api/public/qr/${encodeURIComponent(r.qr_token)}.png" alt="QR Code de entrada"
             width="200" height="200" style="border-radius:12px;background:#fff;padding:8px;box-shadow:0 1px 6px rgba(0,0,0,.12)" />
      </div>` : '';
  document.getElementById('form-slot').innerHTML = `
    <div class="divider"></div>
    <div class="result">
      <div class="badge ok">${check}</div>
      <h2>${ok ? 'Presença confirmada' : 'Resposta registrada'}</h2>
      <p>${esc(r.message)}</p>
      ${qr}
      ${r.updated ? '' : `<div class="note">Precisa alterar sua resposta? Basta acessar este mesmo link novamente e reenviar — seus dados serão atualizados.</div>`}
      <button class="btn btn-ghost btn-sm" style="margin-top:18px" onclick="location.reload()">Enviar nova resposta</button>
      ${whatsappButton('Falar com a organização')}
    </div>`;
}

load();
