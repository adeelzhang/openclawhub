const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3721;

// ── Telegram 配置 ──────────────────────────────────────────
const TG_TOKEN = process.env.TG_TOKEN || '7758997865:AAHLF6_g6p5yq2fowBELz3-WWBWPhFv4uUM';
const TG_CHAT  = process.env.TG_CHAT  || '-4993403801';

function sendTelegram(text) {
  const body = JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: 'HTML' });
  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${TG_TOKEN}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  }, () => {});
  req.on('error', e => console.error('[TG]', e.message));
  req.write(body);
  req.end();
}

// ── 日志目录 ───────────────────────────────────────────────
const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// 东8区时间工具
function cst(d) {
  // 返回东8区的 Date 对象（偏移+8h）
  return new Date((d || new Date()).getTime() + 8 * 3600 * 1000);
}

function logFile() {
  const d = cst();
  const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
  return path.join(LOG_DIR, `access-${ym}.log`);
}

function appendLog(entry) {
  fs.appendFile(logFile(), JSON.stringify(entry) + '\n', () => {});
}

function pruneOldLogs() {
  const cutoff = cst();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 6);
  const cutoffStr = `access-${cutoff.getUTCFullYear()}-${String(cutoff.getUTCMonth()+1).padStart(2,'0')}.log`;
  try {
    fs.readdirSync(LOG_DIR).forEach(f => {
      if (f.startsWith('access-') && f < cutoffStr) {
        fs.unlinkSync(path.join(LOG_DIR, f));
        console.log('[prune]', f);
      }
    });
  } catch(e) { console.error('[prune]', e.message); }
}

// ── 内存滚动窗口（5分钟）─────────────────────────────────
let window5m = { reqs:[], errors4xx:0, errors5xx:0 };

// 爬虫 UA 关键词
const BOT_RE = /bot|crawler|spider|slurp|bingpreview|google|baidu|yandex|sogou|360spider|bytespider|petalbot|semrush|ahrefs|mj12|dataprovider|zgrab|nuclei|masscan|nmap/i;

function isBot(req) {
  const ua = req.headers['user-agent'] || '';
  return BOT_RE.test(ua);
}

// ── 中间件：记录每次请求（含 country、ua，过滤爬虫）────────
app.use((req, res, next) => {
  const ip      = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '';
  const country = (req.headers['cf-ipcountry'] || '').toUpperCase() || 'XX';
  const ua      = req.headers['user-agent'] || '';
  const bot     = isBot(req);
  const t       = Math.floor(Date.now() / 1000);
  res.on('finish', () => {
    const entry = { t, ip, country, path: req.path, status: res.statusCode, bot };
    appendLog(entry);
    if (!bot) {
      window5m.reqs.push(entry);
      if (res.statusCode >= 400 && res.statusCode < 500) window5m.errors4xx++;
      if (res.statusCode >= 500) window5m.errors5xx++;
    }
  });
  next();
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── 加载分类数据 ──────────────────────────────────────────
let CATEGORIES = [];
try {
  const src = fs.readFileSync(path.join(__dirname, 'public', 'data.js'), 'utf8');
  const match = src.match(/const CATEGORIES = (\[[\s\S]*\]);/);
  if (match) CATEGORIES = JSON.parse(match[1]);
} catch(e) { console.error('[data]', e.message); }

// ── 生成 ItemList JSON-LD ─────────────────────────────────
function buildItemListJsonLd() {
  const items = [];
  CATEGORIES.forEach(cat => {
    (cat.items || []).slice(0, 10).forEach((item, i) => {
      items.push({
        '@type': 'ListItem',
        position: items.length + 1,
        name: item.name,
        description: item.desc,
        url: item.url
      });
    });
  });
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'OpenClawZoo AI工具导航',
    description: 'OpenClaw 工具生态导航，300+ 精选资源',
    numberOfItems: items.length,
    itemListElement: items
  });
}

// ── 生成 SSR 静态 HTML（爬虫可见）────────────────────────
function buildSSRHtml() {
  return CATEGORIES.map(cat => {
    const items = (cat.items || []).map(item =>
      `<li><a href="${item.url || '#'}" rel="noopener noreferrer"><strong>${item.name}</strong>${item.nameEn && item.nameEn !== item.name ? ` (${item.nameEn})` : ''} — ${item.desc || ''}</a></li>`
    ).join('');
    return `<section id="ssr-${cat.id}"><h2>${cat.emoji} ${cat.name}</h2><p>${cat.desc || ''}</p><ul>${items}</ul></section>`;
  }).join('');
}

// 获取 git commit hash 作为静态资源版本号
function getGitHash() {
  try {
    return require('child_process').execSync('git rev-parse --short HEAD', {cwd: __dirname}).toString().trim();
  } catch(e) {
    return Date.now().toString(36);
  }
}
const ASSET_VER = getGitHash();

// 内存缓存，启动时预渲染一次，避免每次请求读文件
let _cachedHtml = null;
function getCachedHtml() {
  if (_cachedHtml) return _cachedHtml;
  const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const itemListJsonLd = buildItemListJsonLd();
  const ssrHtml = buildSSRHtml();
  _cachedHtml = html
    .replace('</head>', `<script type="application/ld+json">${itemListJsonLd}</script>\n</head>`)
    .replace('  <div class="layout">', `  <div id="ssr-content" style="display:none" aria-hidden="true">${ssrHtml}</div>\n  <div class="layout">`)
    .replace('href="style.css"', `href="style.css?v=${ASSET_VER}"`)
    .replace(/src="(app\.js|data\.v2\.js|data\.min\.js)(\?v=[^"]*)?"/, (m, f) => `src="${f}?v=${ASSET_VER}"`);
  return _cachedHtml;
}

app.get('/', (req, res) => {
  try {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(getCachedHtml());
  } catch(e) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// 根据 Cloudflare CF-IPCountry 头判断地区
app.get('/api/region', (req, res) => {
  const country = (req.headers['cf-ipcountry'] || '').toUpperCase();
  res.json({ country: country || 'UNKNOWN' });
});

// ── 统计工具函数 ───────────────────────────────────────────
function readLogsInRange(fromTs) {
  const now = Date.now() / 1000;
  const files = fs.readdirSync(LOG_DIR).filter(f => f.startsWith('access-')).sort();
  const entries = [];
  for (const f of files) {
    try {
      const lines = fs.readFileSync(path.join(LOG_DIR, f), 'utf8').split('\n').filter(Boolean);
      for (const l of lines) {
        try {
          const e = JSON.parse(l);
          if (e.t >= fromTs && e.t <= now) entries.push(e);
        } catch(_) {}
      }
    } catch(_) {}
  }
  return entries;
}

function calcStats(entries, region) {
  // region: 'cn' | 'overseas' | undefined(全部)
  // 只统计真实用户（非爬虫）、主页、200/304 均计入 UV 但 PV 只计 200
  let filtered = entries.filter(e => !e.bot);
  if (region === 'cn')       filtered = filtered.filter(e => e.country === 'CN');
  if (region === 'overseas') filtered = filtered.filter(e => e.country && e.country !== 'CN' && e.country !== 'XX');
  const pvEntries = filtered.filter(e => e.path === '/' && e.status === 200);
  const uvEntries = filtered.filter(e => e.path === '/' && (e.status === 200 || e.status === 304));
  const pv = pvEntries.length;
  const uv = new Set(uvEntries.map(e => e.ip)).size;
  return { pv, uv };
}

function calcDailyStats(monthEntries) {
  // 按东8区日期分组，返回当月每天的 PV/UV
  const days = {};
  monthEntries.forEach(e => {
    if (e.bot || e.path !== '/' || e.status !== 200) return;
    const d = new Date((e.t || 0) * 1000 + 8 * 3600 * 1000);
    const day = d.toISOString().slice(5, 10); // MM-DD
    if (!days[day]) days[day] = { pv: 0, uv: new Set() };
    days[day].pv++;
    days[day].uv.add(e.ip);
  });
  return Object.keys(days).sort().map(d => `  ${d}  PV:${days[d].pv}  UV:${days[d].uv.size}`).join('\n');
}

function topPaths(entries, n = 3) {
  const cnt = {};
  entries.forEach(e => { cnt[e.path] = (cnt[e.path] || 0) + 1; });
  return Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, n);
}

// 以下函数返回东8区某天/周/月起始时刻的 Unix 时间戳
// 思路：先把当前时间转为东8区，取年月日，构造CST零点（UTC-8h）
function startOfDay(d) {
  const c = cst(d);
  const y = c.getUTCFullYear(), mo = c.getUTCMonth(), day = c.getUTCDate();
  return (Date.UTC(y, mo, day) - 8 * 3600 * 1000) / 1000;
}
function startOfWeek(d) {
  const c = cst(d);
  const dow = c.getUTCDay();
  const y = c.getUTCFullYear(), mo = c.getUTCMonth(), day = c.getUTCDate() - dow;
  return (Date.UTC(y, mo, day) - 8 * 3600 * 1000) / 1000;
}
function startOfMonth(d) {
  const c = cst(d);
  const y = c.getUTCFullYear(), mo = c.getUTCMonth();
  return (Date.UTC(y, mo, 1) - 8 * 3600 * 1000) / 1000;
}

// ── 5分钟定时推送 ──────────────────────────────────────────
function report() {
  const now = cst();
  const w   = window5m;
  window5m  = { reqs: [], errors4xx: 0, errors5xx: 0 };

  const reqs5m = w.reqs;
  const ips5m  = new Set(reqs5m.map(e => e.ip)).size;
  const pv5m   = reqs5m.filter(e => e.path === '/').length;
  const cn5m   = reqs5m.filter(e => e.country === 'CN').length;
  const os5m   = reqs5m.filter(e => e.country && e.country !== 'CN' && e.country !== 'XX').length;
  const top    = topPaths(reqs5m);

  const dayEntries   = readLogsInRange(startOfDay(now));
  const weekEntries  = readLogsInRange(startOfWeek(now));
  const monthEntries = readLogsInRange(startOfMonth(now));

  const dayCN  = calcStats(dayEntries, 'cn');
  const dayOS  = calcStats(dayEntries, 'overseas');
  const weekCN = calcStats(weekEntries, 'cn');
  const weekOS = calcStats(weekEntries, 'overseas');
  const monCN  = calcStats(monthEntries, 'cn');
  const monOS  = calcStats(monthEntries, 'overseas');

  const pad = n => String(n).padStart(2, '0');
  const timeStr = `${now.getUTCFullYear()}-${pad(now.getUTCMonth()+1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())} CST`;
  const topStr  = top.length ? top.map(([p, c]) => `  ${p} ×${c}`).join('\n') : '  (无请求)';

  const dailyStr = calcDailyStats(monthEntries);

  const msg =
`📊 <b>OpenClawZoo 监控报告</b>
🕐 ${timeStr}

<b>【过去5分钟】</b>
请求: ${reqs5m.length}  IP: ${ips5m}  PV: ${pv5m}
🇨🇳 国内: ${cn5m}  🌍 海外: ${os5m}
错误: ${w.errors4xx + w.errors5xx} (4xx:${w.errors4xx}  5xx:${w.errors5xx})
Top路径:
${topStr}

<b>【今日】</b>
🇨🇳 国内  PV: ${dayCN.pv}   UV: ${dayCN.uv}
🌍 海外  PV: ${dayOS.pv}   UV: ${dayOS.uv}

<b>【本周】</b>
🇨🇳 国内  PV: ${weekCN.pv}   UV: ${weekCN.uv}
🌍 海外  PV: ${weekOS.pv}   UV: ${weekOS.uv}

<b>【本月】</b>
🇨🇳 国内  PV: ${monCN.pv}   UV: ${monCN.uv}
🌍 海外  PV: ${monOS.pv}   UV: ${monOS.uv}

<b>【本月每日明细】</b>
${dailyStr}`;

  sendTelegram(msg);
  pruneOldLogs();
}

setInterval(report, 5 * 60 * 1000);

// ── 百度主动推送 ─────────────────────────────────────────
function baiduPush() {
  const token = 'Ed2AqwMytzDs9F5H';
  const site = 'www.openclawzoo.com';
  const baseUrl = 'https://www.openclawzoo.com';
  const urls = [
    baseUrl + '/',
    ...CATEGORIES.map(c => baseUrl + '/#' + c.id)
  ].join('\n');
  const https = require('https');
  const urlObj = new URL(`http://data.zz.baidu.com/urls?site=${site}&token=${token}`);
  const options = {
    hostname: 'data.zz.baidu.com',
    path: `/urls?site=${encodeURIComponent(site)}&token=${token}`,
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(urls) }
  };
  const req = require('http').request(options, res => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => console.log('[baidu-push]', d));
  });
  req.on('error', e => console.error('[baidu-push error]', e.message));
  req.write(urls);
  req.end();
}

app.listen(PORT, () => {
  console.log(`OpenClawHub running at http://localhost:${PORT}`);
  // 启动后延迟5秒推送，确保服务完全就绪
  setTimeout(baiduPush, 5000);
});
