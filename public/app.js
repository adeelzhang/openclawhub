const VISIBLE_COUNT = 60;
let currentLang = localStorage.getItem('lang') || 'zh';
let activeEngine = 'google';

const I18N = {
  zh: {
    tagline: 'OpenClaw 工具生态导航中心',
    slogan: '由 OpenClaw 自助运营的 Claw 社区',
    footer: 'OpenClawZoo © 2026 · 专注 OpenClaw 生态导航 · <a href="/privacy.html" style="color:inherit;opacity:0.7;">隐私政策</a>',
    searchPlaceholder: '搜索...',
    expand: '展开更多',
    collapse: '收起',
    remaining: '还有',
    countUnit: '个',
    itemsUnit: '个资源',
    tags: { cloud: '云端', local: '本地', free: '免费', hot: '热门' }
  },
  en: {
    tagline: 'OpenClaw Ecosystem Navigation Hub',
    slogan: 'A self-operated Claw community powered by OpenClaw',
    footer: 'OpenClawZoo © 2026 · Your OpenClaw Ecosystem Guide · <a href="/privacy.html" style="color:inherit;opacity:0.7;">Privacy Policy</a>',
    searchPlaceholder: 'Search...',
    expand: 'Show more',
    collapse: 'Collapse',
    remaining: '',
    countUnit: ' more',
    itemsUnit: ' resources',
    tags: { cloud: 'Cloud', local: 'Local', free: 'Free', hot: 'Hot' }
  }
};

function t(key) {
  return (I18N[currentLang] && I18N[currentLang][key]) || I18N.zh[key] || key;
}

function langText(item, key) {
  const enKey = key + 'En';
  if (currentLang === 'en' && item[enKey]) return item[enKey];
  return item[key] || '';
}

// Search engine tabs
document.querySelectorAll('.stab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.stab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeEngine = btn.dataset.engine;
  });
});

function doSearch() {
  const q = document.getElementById('searchInput').value.trim();
  if (!q) return;
  const url = activeEngine === 'google'
    ? `https://www.google.com/search?q=${encodeURIComponent(q)}`
    : `https://www.baidu.com/s?wd=${encodeURIComponent(q)}`;
  window.open(url, '_blank');
}
document.getElementById('searchBtn').addEventListener('click', doSearch);
document.getElementById('searchInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') doSearch();
});

// Language toggle
document.querySelectorAll('.lang-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const lang = btn.dataset.lang;
    if (lang === currentLang) return;
    currentLang = lang;
    localStorage.setItem('lang', lang);
    document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.documentElement.lang = lang;
    applyI18n();
    rerenderAll();
  });
});

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    el.innerHTML = t(key);
  });
  document.getElementById('searchInput').placeholder = t('searchPlaceholder');
}

const TAG_MAP = { cloud: 'cloud', local: 'local', free: 'free', hot: 'hot' };

function getFavicon(url) {
  try {
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`;
  } catch { return null; }
}

function renderCard(item) {
  const card = document.createElement('a');
  card.className = 'card';
  card.href = item.url || '#';
  card.target = '_blank';
  card.rel = 'noopener noreferrer';

  const favicon = getFavicon(item.url);
  const itemName = langText(item, 'name');
  const iconHtml = favicon
    ? `<img src="${favicon}" alt="${itemName} logo" onerror="this.style.display='none';this.parentNode.innerHTML+='${item.icon || '🔗'}'"/>`
    : `${item.icon || '🔗'}`;

  const tagClass = TAG_MAP[item.tag] || 'cloud';
  const tagLabel = t('tags')[item.tag] || item.tag || '';
  const name = itemName;
  const desc = langText(item, 'desc');

  card.innerHTML = `
    <div class="card-top">
      <div class="card-icon">${iconHtml}</div>
      <div class="card-name">${name}</div>
      ${item.tag ? `<span class="card-tag tag-${tagClass}">${tagLabel}</span>` : ''}
    </div>
    <div class="card-desc">${desc}</div>
  `;
  return card;
}

function renderSection(cat) {
  const section = document.createElement('section');
  section.className = 'section';
  section.id = cat.id;

  const total = cat.items.length;
  const visible = cat.items.slice(0, VISIBLE_COUNT);
  const hidden = cat.items.slice(VISIBLE_COUNT);
  const catName = langText(cat, 'name');
  const catDesc = langText(cat, 'desc');

  const header = document.createElement('div');
  header.className = 'section-header';
  header.innerHTML = `
    <span class="section-emoji">${cat.emoji}</span>
    <h2 class="section-title">${catName}</h2>
    <span class="section-desc">${catDesc}</span>
    <span class="section-count">${total} ${t('itemsUnit')}</span>
  `;
  section.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'cards-grid';
  visible.forEach(item => grid.appendChild(renderCard(item)));
  section.appendChild(grid);

  let hiddenContainer = null;
  if (hidden.length > 0) {
    hiddenContainer = document.createElement('div');
    hiddenContainer.className = 'cards-grid hidden-cards';
    hidden.forEach(item => hiddenContainer.appendChild(renderCard(item)));
    section.appendChild(hiddenContainer);

    const wrap = document.createElement('div');
    wrap.className = 'expand-wrap';
    const btn = document.createElement('button');
    btn.className = 'expand-btn';
    let expanded = false;
    const updateBtn = () => {
      btn.innerHTML = expanded
        ? `<span>${t('collapse')}</span><span>▴</span>`
        : `<span>${t('expand')}</span><span>▾ ${t('remaining')} ${hidden.length} ${t('countUnit')}</span>`;
    };
    updateBtn();
    btn.addEventListener('click', () => {
      expanded = !expanded;
      hiddenContainer.classList.toggle('expanded', expanded);
      updateBtn();
    });
    wrap.appendChild(btn);
    section.appendChild(wrap);
  }

  return section;
}

function renderNav() {
  const nav = document.getElementById('sideNav');
  nav.innerHTML = '';
  CATEGORIES.forEach(cat => {
    const item = document.createElement('div');
    item.className = 'nav-item';
    item.dataset.catId = cat.id;
    item.innerHTML = `<span class="nav-emoji">${cat.emoji}</span><span>${langText(cat, 'name')}</span>`;
    item.addEventListener('click', () => {
      document.getElementById(cat.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    nav.appendChild(item);
  });
}

function highlightNav() {
  const navItems = document.querySelectorAll('.nav-item');
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        navItems.forEach(n => n.classList.remove('active'));
        const active = [...navItems].find(n => n.dataset.catId === id);
        if (active) active.classList.add('active');
      }
    });
  }, { rootMargin: '-20% 0px -70% 0px' });
  document.querySelectorAll('.section').forEach(s => observer.observe(s));
}

function rerenderAll() {
  const container = document.getElementById('sections');
  container.innerHTML = '';
  CATEGORIES.forEach(cat => container.appendChild(renderSection(cat)));
  renderNav();
  highlightNav();
  applyI18n();
}

function applyLang(lang) {
  currentLang = lang;
  document.documentElement.lang = lang;
  document.querySelectorAll('.lang-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === lang);
  });
  rerenderAll();
}

function init() {
  // 若用户已手动选择过语言，直接用
  const saved = localStorage.getItem('lang');
  if (saved) {
    applyLang(saved);
    return;
  }
  // 否则请求地区接口，非 CN 默认英文
  fetch('/api/region')
    .then(r => r.json())
    .then(data => {
      const lang = data.country === 'CN' ? 'zh' : 'en';
      applyLang(lang);
    })
    .catch(() => applyLang('zh'));
}

init();
