(function () {
  'use strict';

  /* ─── State (localStorage) ──────────────────────────────────────────────── */
  const STORE      = 'rsvp_onb_v1';
  const MAX_VISITS = 5;
  const MAX_DAYS   = 7;

  function load() { try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; } }
  function save(s) { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch {} }

  function track(key) {
    const s = load();
    if (!s[key]) s[key] = { v: 0, first: Date.now(), done: false };
    s[key].v++;
    save(s);
    return s[key];
  }

  function shouldShow(info) {
    if (info.done) return false;
    const ageDays = (Date.now() - info.first) / 86400000;
    return info.v <= MAX_VISITS || ageDays < MAX_DAYS;
  }

  function dismiss(key) {
    const s = load();
    if (!s[key]) s[key] = {};
    s[key].done = true;
    save(s);
  }

  /* ─── Conteúdo por página ───────────────────────────────────────────────── */
  const PAGES = {
    '/admin/dashboard.html': {
      type: 'welcome',
      title: 'Bem-vindo ao Moura RSVP 👋',
      body: 'Esta é a plataforma de gestão de convites e confirmações do evento. Crie eventos, gerencie convidados e acompanhe as confirmações em tempo real.',
      tips: [
        { icon: '🗓', label: 'Criar um evento',         link: '/admin/event-form.html'   },
        { icon: '👥', label: 'Ver lista de convidados', link: '/admin/dashboard.html'    },
        { icon: '👤', label: 'Gerenciar usuários',      link: '/admin/users.html'        },
      ],
    },
    '/admin/event-detail.html': {
      type: 'module', icon: '🗓', title: 'Gestão do Evento',
      body: 'Aqui fica tudo sobre este evento — convidados, confirmações, categorias e exportação de dados.',
      tips: [
        'Use as abas para navegar entre convidados, relatórios e configurações',
        'Adicione convidados manualmente ou importe via planilha',
        'Exporte a lista completa de participantes a qualquer momento',
      ],
    },
    '/admin/event-form.html': {
      type: 'module', icon: '✏️', title: 'Criar / Editar Evento',
      body: 'Configure todos os detalhes do evento: nome, data, local, capacidade e página pública de inscrição.',
      tips: [
        'Preencha todos os campos obrigatórios antes de publicar',
        'A página pública de inscrição é gerada automaticamente',
        'Você pode editar as informações a qualquer momento',
      ],
    },
    '/admin/users.html': {
      type: 'module', icon: '👤', title: 'Usuários',
      body: 'Gerencie quem tem acesso ao sistema de RSVP. Adicione membros da equipe com papéis diferentes.',
      tips: [
        'Admin tem acesso total a todos os eventos',
        'Gestor gerencia eventos específicos atribuídos a ele',
        'Desative usuários sem perder o histórico deles',
      ],
    },
    '/admin/activity.html': {
      type: 'module', icon: '🕐', title: 'Atividades',
      body: 'Histórico completo de ações no sistema — quem fez o quê e quando.',
      tips: [
        'Filtre por usuário, evento ou tipo de ação',
        'Útil para auditoria e resolução de problemas',
        'As ações mais recentes aparecem no topo',
      ],
    },
    '/admin/lgpd.html': {
      type: 'module', icon: '🔒', title: 'Privacidade & LGPD',
      body: 'Gerenciamento de consentimentos e requisições de apagamento de dados (LGPD).',
      tips: [
        'Atenda requisições de apagamento com rastreabilidade total',
        'Cada ação é registrada com data, hora e responsável',
        'Mantenha os registros de consentimento atualizados',
      ],
    },
    '/admin/trash.html': {
      type: 'module', icon: '🗑', title: 'Lixeira',
      body: 'Eventos e participantes excluídos ficam aqui por 30 dias antes da remoção definitiva.',
      tips: [
        'Restaure itens excluídos por engano com um clique',
        'Após 30 dias, os itens são removidos permanentemente',
        'A lixeira não afeta o desempenho do sistema',
      ],
    },
  };

  /* ─── Estilos ───────────────────────────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('mo-onb-css')) return;
    const s = document.createElement('style');
    s.id = 'mo-onb-css';
    s.textContent = `
      .mo-onb-welcome{background:linear-gradient(135deg,#152C6B 0%,#1a3890 100%);border-radius:16px;padding:22px 24px;margin-bottom:24px;color:#fff;position:relative;overflow:hidden}
      .mo-onb-welcome::before{content:'';position:absolute;right:-50px;top:-50px;width:220px;height:220px;background:rgba(0,194,184,.12);border-radius:50%;pointer-events:none}
      .mo-onb-x{position:absolute;top:12px;right:14px;background:rgba(255,255,255,.13);border:none;color:#fff;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center;transition:background .2s;padding:0;line-height:1}
      .mo-onb-x:hover{background:rgba(255,255,255,.25)}
      .mo-onb-title{font-size:19px;font-weight:700;margin:0 0 6px;line-height:1.3}
      .mo-onb-desc{font-size:13.5px;opacity:.85;margin:0 0 18px;max-width:540px;line-height:1.55}
      .mo-onb-links{display:flex;gap:8px;flex-wrap:wrap}
      .mo-onb-link{display:flex;align-items:center;gap:7px;background:rgba(255,255,255,.11);border:1px solid rgba(255,255,255,.18);border-radius:9px;padding:9px 13px;color:#fff;font-size:12.5px;font-weight:600;text-decoration:none;transition:background .2s;white-space:nowrap}
      .mo-onb-link:hover{background:rgba(255,255,255,.2);color:#fff}
      .mo-onb-footer{margin-top:16px;display:flex;align-items:center}
      .mo-onb-dismiss{font-size:11.5px;color:rgba(255,255,255,.5);background:none;border:none;cursor:pointer;padding:0;text-decoration:underline;text-underline-offset:2px}
      .mo-onb-dismiss:hover{color:rgba(255,255,255,.8)}
      .mo-onb-counter{font-size:11px;color:rgba(255,255,255,.35);margin-left:auto}
      .mo-onb-box{background:var(--off-white,#F4F6FA);border:1px solid var(--gray-soft,#eef2f7);border-left:4px solid var(--cyan,#00C2B8);border-radius:14px;padding:14px 16px;margin-bottom:20px;position:relative}
      .mo-onb-box-x{position:absolute;top:9px;right:12px;background:none;border:none;cursor:pointer;color:var(--muted,#64748B);font-size:18px;line-height:1;padding:0}
      .mo-onb-box-x:hover{color:var(--charcoal,#16203A)}
      .mo-onb-box-head{display:flex;align-items:center;gap:7px;margin-bottom:6px}
      .mo-onb-box-ico{font-size:17px}
      .mo-onb-box-ttl{font-size:14px;font-weight:700;color:var(--charcoal,#16203A)}
      .mo-onb-box-body{font-size:13px;color:var(--muted,#64748B);line-height:1.5;margin:0 0 10px}
      .mo-onb-box-tips{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px}
      .mo-onb-box-tips li{font-size:12.5px;color:var(--charcoal,#16203A);display:flex;gap:6px;align-items:flex-start;line-height:1.4}
      .mo-onb-box-tips li::before{content:'→';color:var(--cyan,#00C2B8);font-weight:700;flex-shrink:0;margin-top:1px}
    `;
    document.head.appendChild(s);
  }

  /* ─── Componentes ───────────────────────────────────────────────────────── */
  function renderWelcome(cfg, key, visits) {
    const el = document.createElement('div');
    el.className = 'mo-onb-welcome';
    el.innerHTML = `
      <button class="mo-onb-x" title="Fechar">×</button>
      <div class="mo-onb-title">${cfg.title}</div>
      <div class="mo-onb-desc">${cfg.body}</div>
      <div class="mo-onb-links">
        ${cfg.tips.map(t => `<a class="mo-onb-link" href="${t.link}"><span>${t.icon}</span>${t.label}</a>`).join('')}
      </div>
      <div class="mo-onb-footer">
        <button class="mo-onb-dismiss">Não mostrar mais</button>
        <span class="mo-onb-counter">Visita ${visits} de ${MAX_VISITS}</span>
      </div>`;
    el.querySelector('.mo-onb-x').onclick      = () => el.remove();
    el.querySelector('.mo-onb-dismiss').onclick = () => { dismiss(key); el.remove(); };
    return el;
  }

  function renderModuleBox(cfg, key) {
    const el = document.createElement('div');
    el.className = 'mo-onb-box';
    el.innerHTML = `
      <button class="mo-onb-box-x" title="Fechar">×</button>
      <div class="mo-onb-box-head">
        <span class="mo-onb-box-ico">${cfg.icon}</span>
        <span class="mo-onb-box-ttl">${cfg.title}</span>
      </div>
      <p class="mo-onb-box-body">${cfg.body}</p>
      <ul class="mo-onb-box-tips">${cfg.tips.map(t => `<li>${t}</li>`).join('')}</ul>`;
    el.querySelector('.mo-onb-box-x').onclick = () => { dismiss(key); el.remove(); };
    return el;
  }

  /* ─── Bootstrap ─────────────────────────────────────────────────────────── */
  function init() {
    const key = location.pathname.replace(/\/+$/, '') || '/';
    const cfg = PAGES[key];
    if (!cfg) return;

    const info = track(key);
    if (!shouldShow(info)) return;

    injectStyles();

    const el = cfg.type === 'welcome'
      ? renderWelcome(cfg, key, info.v)
      : renderModuleBox(cfg, key);

    const pageHead = document.querySelector('main .page-head');
    const main     = document.querySelector('main');
    if (pageHead)  pageHead.insertAdjacentElement('afterend', el);
    else if (main) main.insertBefore(el, main.firstChild);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 350));
  } else {
    setTimeout(init, 350);
  }
})();
