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
    const r = await fetch(`/api/public/events/${slug}`);
    if (r.status === 404) {
      root.innerHTML = `<div class="rsvp-card closed-box"><h2>Evento não encontrado</h2><p class="muted">Verifique o link recebido.</p></div>`;
      return;
    }
    if (!r.ok) throw new Error('network');
    EVENT = await r.json();
  } catch {
    root.innerHTML = `<div class="rsvp-card closed-box"><h2>Não foi possível carregar agora.</h2><p class="muted">Verifique sua conexão.</p><button class="btn btn-ghost btn-sm" style="margin-top:14px" onclick="load()">Tentar novamente</button></div>`;
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
// baseClass permite uma variação de estilo (ex.: 'lp-countdown' no hero da landing).
let countdownTimer = null;
function buildCountdown(e, baseClass = 'rsvp-countdown') {
  if (!e.event_date) return '';
  const datePart = e.event_date; // YYYY-MM-DD
  const timePart = e.event_time || '00:00';
  const eventMs = new Date(`${datePart}T${timePart}:00-03:00`).getTime();
  if (isNaN(eventMs) || eventMs <= Date.now()) return '';
  return `<div id="countdown" class="${baseClass}" data-base="${baseClass}"></div>`;
}

function startCountdown(e) {
  const el = document.getElementById('countdown');
  if (!el) return;
  const base = el.dataset.base || 'rsvp-countdown';
  const datePart = e.event_date;
  const timePart = e.event_time || '00:00';
  const eventMs = new Date(`${datePart}T${timePart}:00-03:00`).getTime();

  function tick() {
    const diff = eventMs - Date.now();
    if (diff <= 0) { el.remove(); if (countdownTimer) clearInterval(countdownTimer); return; }
    const moreThan24h = diff > 86400000;
    const totalSec = Math.floor(diff / 1000);
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const warn = d === 0;
    const pad = (n) => String(n).padStart(2, '0');
    let parts = '';
    if (d > 0) parts += `<span class="cd-unit"><strong>${d}</strong><em>dias</em></span>`;
    parts += `<span class="cd-unit"><strong>${pad(h)}</strong><em>horas</em></span>`;
    parts += `<span class="cd-unit"><strong>${pad(m)}</strong><em>min</em></span>`;
    if (!moreThan24h) parts += `<span class="cd-unit"><strong>${pad(s)}</strong><em>seg</em></span>`;
    el.className = `${base}${warn ? ` ${base}-warn` : ''}`;
    el.innerHTML = `<span class="cd-label">Faltam</span><div class="cd-units">${parts}</div>`;

    // Reschedule with appropriate interval
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(tick, moreThan24h ? 60000 : 1000);
  }
  if (countdownTimer) clearInterval(countdownTimer);
  tick();
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

// Ícones de seção da landing (mostrados ao lado do título).
const LP_SECTION_ICON = {
  video:    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="m10 9 5 3-5 3z" fill="currentColor" stroke="none"/></svg>',
  agenda:   '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  location: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-5.7-7-11a7 7 0 0 1 14 0c0 5.3-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  sponsors: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.65A4 4 0 0 1 19 11c0 5.5-7 10-7 10z"/></svg>',
  faq:      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 2-2 3"/><circle cx="12" cy="16.5" r=".6" fill="currentColor"/></svg>',
};

function renderLanding() {
  const e = EVENT;
  const lc = e.landing_config || { sections: [] };
  // Respeita a ORDEM definida pelo organizador (drag-and-drop no editor).
  const sections = (Array.isArray(lc.sections) ? lc.sections : []).filter((s) => s && s.enabled);

  document.body.classList.add('lp-body');

  const heroBg = e.cover_image ? `style="background-image:url('${e.cover_image}')"` : '';
  const dateTxt = e.event_date ? fmtDateBR(e.event_date) : '';
  const locationTxt = [e.location, e.city].filter(Boolean).join(' · ');
  const heroActions = buildActionButtons(e);

  root.innerHTML = `
    <div class="lp-page">
      <section class="lp-hero ${e.cover_image ? '' : 'lp-hero-nocover'}" ${heroBg}>
        <div class="lp-hero-inner">
          ${e.client_logo ? `<img class="lp-hero-logo" src="${e.client_logo}" alt="" />` : ''}
          <div class="lp-hero-eyebrow">Você está convidado</div>
          <h1 class="lp-hero-title">${esc(e.name)}</h1>
          <div class="lp-hero-meta">
            ${lpMetaItem(ICON.cal, dateTxt)}
            ${lpMetaItem(ICON.clock, e.event_time)}
            ${lpMetaItem(ICON.pin, locationTxt)}
          </div>
          ${buildCountdown(e, 'lp-countdown')}
          <div class="lp-hero-ctarow">
            <a href="#lp-rsvp" class="lp-hero-cta">Confirmar Presença</a>
          </div>
        </div>
        <a href="#lp-content" class="lp-scroll-hint" aria-label="Ver mais">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m6 9 6 6 6-6"/></svg>
        </a>
      </section>

      <div class="lp-sections" id="lp-content">
        ${e.description ? `
        <section class="lp-section lp-reveal">
          <div class="lp-about">${esc(e.description)}</div>
        </section>` : ''}

        ${renderLpSections(sections)}

        ${heroActions ? `<section class="lp-section lp-reveal"><div class="lp-quickactions">${heroActions}</div></section>` : ''}

        <section class="lp-section lp-reveal" id="lp-rsvp">
          <div class="lp-rsvp-head">
            <h2 class="lp-section-title">Confirme sua presença</h2>
            <p class="lp-rsvp-sub">Preencha os dados abaixo para garantir seu lugar.</p>
          </div>
          <div class="lp-rsvp-card">
            <div id="form-slot"></div>
          </div>
        </section>
      </div>

      <footer class="lp-footer rsvp-footer">
        <img class="footer-logo" src="/assets/img/logo-moura.png" alt="Moura" />
        <div class="footer-title">Plataforma de Confirmação de Presença</div>
        <div class="footer-links">
          <a href="/legal.html#docsCard" target="_blank" rel="noopener">Política de Privacidade</a> ·
          <a href="/legal.html#terms" target="_blank" rel="noopener">Termos de Uso</a>
        </div>
      </footer>
    </div>

    <a href="#lp-rsvp" class="lp-sticky-cta">Confirmar Presença</a>`;

  startCountdown(e);
  initReveal();
  initStickyCta();

  if (e.closed) {
    document.querySelector('.lp-sticky-cta')?.remove();
    // Botão "Confirmar Presença" do hero: num evento encerrado, evita comunicação
    // contraditória — troca o texto e desabilita o link (rola só até o aviso).
    const heroCta = document.querySelector('.lp-hero-cta');
    if (heroCta) {
      heroCta.textContent = 'Confirmações encerradas';
      heroCta.classList.add('disabled');
      heroCta.setAttribute('aria-disabled', 'true');
      heroCta.style.pointerEvents = 'none';
      heroCta.style.opacity = '0.6';
    }
    document.getElementById('form-slot').innerHTML = `
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

// Renderiza as seções premium na ORDEM salva pelo organizador.
function renderLpSections(sections) {
  return sections.map((sec) => {
    const type = sec.type;
    const icon = LP_SECTION_ICON[type] || '';
    const title = sec.title
      ? `<h2 class="lp-section-title"><span class="lp-section-ico">${icon}</span>${esc(sec.title)}</h2>` : '';
    if (type === 'video') {
      const embed = toEmbedUrl(sec.url);
      if (!embed) return '';
      return `<section class="lp-section lp-reveal">${title}
        <div class="lp-video-wrap"><iframe src="${esc(embed)}" allowfullscreen loading="lazy"></iframe></div>
      </section>`;
    }
    if (type === 'agenda') {
      const items = (sec.items || []).filter((it) => it.title);
      if (!items.length) return '';
      const rows = items.map((it) => `
        <div class="lp-timeline-item">
          <div class="lp-timeline-marker">
            <span class="lp-timeline-time">${esc(it.time || '')}</span>
            <div class="lp-timeline-dot"></div>
          </div>
          <div class="lp-timeline-body">
            <strong>${esc(it.title)}</strong>
            ${it.description ? `<p>${esc(it.description)}</p>` : ''}
          </div>
        </div>`).join('');
      return `<section class="lp-section lp-reveal">${title}<div class="lp-timeline">${rows}</div></section>`;
    }
    if (type === 'location') {
      if (!sec.embed_url) return '';
      return `<section class="lp-section lp-reveal">${title}
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
      return `<section class="lp-section lp-reveal">${title}<div class="lp-sponsors-grid">${cards}</div></section>`;
    }
    if (type === 'faq') {
      const items = (sec.items || []).filter((it) => it.question);
      if (!items.length) return '';
      const chevron = '<svg class="lp-faq-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg>';
      const rows = items.map((it, i) => `
        <div class="lp-faq-item" data-faq="${i}">
          <button type="button" class="lp-faq-q">${esc(it.question)}${chevron}</button>
          <div class="lp-faq-a"><div class="lp-faq-a-inner">${esc(it.answer || '')}</div></div>
        </div>`).join('');
      return `<section class="lp-section lp-reveal">${title}<div class="lp-faq">${rows}</div></section>`;
    }
    return '';
  }).join('');
}

function initFaq() {
  document.querySelectorAll('.lp-faq-q').forEach((q) => {
    q.addEventListener('click', () => q.closest('.lp-faq-item').classList.toggle('open'));
  });
}

// Revela as seções suavemente conforme entram na tela.
function initReveal() {
  const els = document.querySelectorAll('.lp-reveal');
  if (!('IntersectionObserver' in window) || !els.length) {
    els.forEach((el) => el.classList.add('lp-revealed'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.classList.add('lp-revealed'); io.unobserve(entry.target); }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  els.forEach((el) => io.observe(el));
}

// Botão flutuante "Confirmar Presença": some quando o formulário está visível.
function initStickyCta() {
  const cta = document.querySelector('.lp-sticky-cta');
  const target = document.getElementById('lp-rsvp');
  if (!cta || !target) return;
  if (!('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => cta.classList.toggle('lp-sticky-hidden', entry.isIntersecting));
  }, { threshold: 0.15 });
  io.observe(target);
}

// Renderiza um campo configurável (builtin → name=chave; personalizado → data-ckey*).
function optField(f) {
  if (!f.enabled) return '';
  const builtinTypes = { email: 'email', phone: 'tel' };
  const req = f.required ? '<span class="req">*</span>' : '';
  // id único por campo, para o <label for> apontar ao input (acessibilidade:
  // antes o leitor de tela não anunciava o nome do campo). Grupos radio/checkbox
  // não têm um único input — recebem aria-label no conjunto.
  const fldId = 'f_' + String(f.key || '').replace(/[^A-Za-z0-9_]/g, '');
  const groupTypes = ['radio', 'boolean', 'checkbox'];
  const isGroup = !f.builtin && groupTypes.includes(f.type);
  const label = isGroup
    ? `<label>${esc(f.label)} ${req}</label>`
    : `<label for="${fldId}">${esc(f.label)} ${req}</label>`;
  if (f.builtin) {
    const extraAttrs = {
      email: 'autocomplete="email" inputmode="email"',
      phone: 'autocomplete="tel" inputmode="tel"',
      company: 'autocomplete="organization"',
      role: 'autocomplete="organization-title"',
    }[f.key] || '';
    return `<div class="field">${label}
      <input id="${fldId}" type="${builtinTypes[f.key] || 'text'}" name="${f.key}" ${f.required ? 'required' : ''} ${extraAttrs} />
    </div>`;
  }
  const key = esc(f.key);
  const opts = f.options || [];
  let control;
  switch (f.type) {
    case 'textarea':
      control = `<textarea id="${fldId}" data-ckey="${key}" ${f.required ? 'required' : ''}></textarea>`; break;
    case 'number':
      control = `<input id="${fldId}" type="number" data-ckey="${key}" ${f.required ? 'required' : ''} />`; break;
    case 'date':
      control = `<input id="${fldId}" type="date" data-ckey="${key}" ${f.required ? 'required' : ''} />`; break;
    case 'select':
      control = `<select id="${fldId}" data-ckey="${key}" ${f.required ? 'required' : ''}>
        <option value="">Selecione…</option>
        ${opts.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}
      </select>`; break;
    case 'radio':
      control = `<div class="opt-group" role="radiogroup" aria-label="${esc(f.label)}">${opts.map((o) => `
        <label class="opt"><input type="radio" name="ck_${key}" data-ckeyradio="${key}" value="${esc(o)}" /> ${esc(o)}</label>`).join('')}</div>`; break;
    case 'boolean':
      control = `<div class="opt-group" role="radiogroup" aria-label="${esc(f.label)}">
        <label class="opt"><input type="radio" name="ck_${key}" data-ckeyradio="${key}" value="Sim" /> Sim</label>
        <label class="opt"><input type="radio" name="ck_${key}" data-ckeyradio="${key}" value="Não" /> Não</label>
      </div>`; break;
    case 'checkbox':
      control = `<div class="opt-group" role="group" aria-label="${esc(f.label)}">${opts.map((o) => `
        <label class="opt"><input type="checkbox" data-ckeymulti="${key}" value="${esc(o)}" /> ${esc(o)}</label>`).join('')}</div>`; break;
    default:
      control = `<input id="${fldId}" type="text" data-ckey="${key}" ${f.required ? 'required' : ''} />`;
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
      <label for="f_name">Nome completo <span class="req">*</span></label>
      <input id="f_name" type="text" name="name" required autocomplete="name" placeholder="Nome e sobrenome" />
    </div>
    <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0" />
    ${fieldsHtml}

    <div class="divider"></div>
    <p class="choice-q">Você participará deste evento? <span class="req">*</span></p>
    <div class="choices" id="choices-block">
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
        <span>Li e concordo com a <a href="/legal.html#docsCard" target="_blank" rel="noopener">Política de Privacidade</a>.</span>
      </label>
      <label class="consent-item">
        <input type="checkbox" id="cs-data" />
        <span>Autorizo o tratamento dos meus dados pessoais para fins de organização do evento, credenciamento, comunicação e execução dos serviços, conforme a LGPD.</span>
      </label>
    </div>
    <p class="error-msg hidden" id="err"></p>
    <button class="btn btn-primary" id="submit" style="width:100%;margin-top:18px">Enviar resposta</button>
    <hr style="border:none;border-top:1px solid var(--gray-soft,#e2e8f0);margin:20px 0 4px">
    <div style="text-align:center;font-size:13px;color:var(--muted,#64748b);margin-bottom:8px">Dúvidas? Fale com a organização</div>
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
  if (!body.response) {
    const choicesEl = document.getElementById('choices-block');
    if (choicesEl) { choicesEl.style.border = '2px solid var(--danger)'; choicesEl.style.borderRadius = '10px'; choicesEl.style.padding = '8px'; choicesEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    return showErr('Selecione se você participará ou não do evento.');
  }
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
    const x = await fetch(`/api/public/events/${slug}/rsvp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    // Tenta interpretar como JSON; se o servidor responder algo que não é JSON
    // (página de erro 502/504 de proxy/CDN, timeout), evita o erro técnico em
    // inglês ("Unexpected token <…") e mostra uma mensagem amigável.
    let d = null;
    try { d = await x.json(); } catch { d = null; }
    // Homônimo (409): em vez de um erro seco, mostra um cartão com orientação e
    // um caminho de ação (falar com a organização).
    if (x.status === 409 && d && d.error) {
      showHomonymConflict(d.error);
      btn.disabled = false; btn.textContent = 'Enviar resposta';
      return;
    }
    if (!x.ok || !d) {
      throw new Error((d && d.error) || 'Não foi possível enviar sua resposta agora. Verifique sua conexão e tente novamente.');
    }
    showResult(d);
  } catch (e2) {
    btn.disabled = false; btn.textContent = 'Enviar resposta';
    showErr(e2.message || 'Não foi possível enviar sua resposta agora. Verifique sua conexão e tente novamente.');
  }
}
function showErr(m) {
  const err = document.getElementById('err');
  err.textContent = m;
  err.classList.remove('hidden');
  err.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// 409 (homônimo sem casamento de contato): exibe um cartão com orientação clara e
// um caminho de ação (WhatsApp da organização, quando configurado) — em vez de só
// uma linha de erro. Liberar homônimos com contato distinto exige mudar o índice
// único por nome no banco (afeta a deduplicação do Check-in) e fica como evolução.
function showHomonymConflict(msg) {
  showErr(msg);
  document.getElementById('homonymHelp')?.remove();
  const wa = (typeof whatsappButton === 'function') ? whatsappButton('Falar com a organização') : '';
  const box = document.createElement('div');
  box.id = 'homonymHelp';
  box.style.cssText = 'margin-top:12px;padding:14px;border:1px solid var(--gray,#e2e8f0);border-radius:12px;background:#fff';
  box.innerHTML = `
    <p style="margin:0 0 8px;font-weight:600;font-size:14px">Já existe uma confirmação com este nome</p>
    <p class="muted" style="margin:0 0 ${wa ? '12px' : '0'};font-size:13px">Se foi você que já confirmou, não precisa fazer nada. Se você é outra pessoa com o mesmo nome, fale com a organização para registrar sua presença.</p>
    ${wa}`;
  document.getElementById('form-slot').appendChild(box);
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function showResult(r) {
  if (r.response === 'confirmado' && !r.qr_token) {
    showErr('Não recebemos sua confirmação corretamente. Tente novamente.');
    return;
  }
  const ok = r.response === 'confirmado';
  const check = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>';
  // Código de entrada (QR): exibido apenas para quem confirmou presença.
  const qr = (ok && r.qr_token) ? `
      <div class="entry-qr" style="margin-top:22px;padding-top:18px;border-top:1px solid rgba(0,0,0,.08)">
        <p style="font-weight:600;margin:0 0 4px">Seu código de entrada</p>
        <p class="muted" style="margin:0 0 12px;font-size:14px">Apresente este QR Code na entrada do evento.</p>
        <img src="/api/public/qr/${encodeURIComponent(r.qr_token)}.png" alt="QR Code de entrada"
             width="200" height="200" style="border-radius:12px;background:#fff;padding:8px;box-shadow:0 1px 6px rgba(0,0,0,.12)" />
        <div style="margin-top:14px">
          <a class="btn btn-primary btn-sm" href="/api/public/qr/${encodeURIComponent(r.qr_token)}.png"
             download="qrcode-entrada.png">⬇ Baixar QR Code</a>
        </div>
        <p class="muted" style="margin:10px 0 0;font-size:12.5px">Dica: salve a imagem ou tire um print para não depender da internet na entrada.</p>
      </div>` : '';
  document.getElementById('form-slot').innerHTML = `
    <div class="divider"></div>
    <div class="result">
      <div class="badge ok">${check}</div>
      <h2>${ok ? 'Presença confirmada' : 'Resposta registrada'}</h2>
      <p>${esc(r.message)}</p>
      ${qr}
      ${r.updated ? '' : `<div class="note">Precisa alterar sua resposta? Basta acessar este mesmo link novamente e reenviar — seus dados serão atualizados.</div>`}
      ${whatsappButton('Falar com a organização')}
    </div>`;
}

load();
