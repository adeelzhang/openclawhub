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

function logFile() {
  const d = new Date();
  const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
  return path.join(LOG_DIR, `access-${ym}.log`);
}

function appendLog(entry) {
  fs.appendFile(logFile(), JSON.stringify(entry) + '\n', () => {});
}

// 删除 6 个月前的日志文件
function pruneOldLogs() {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 6);
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

// ── 中间件：记录每次请求 ───────────────────────────────────
app.use((req, res, next) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '';
  const t  = Math.floor(Date.now() / 1000);
  res.on('finish', () => {
    const entry = { t, ip, path: req.path, status: res.statusCode };
    appendLog(entry);
    window5m.reqs.push(entry);
    if (res.statusCode >= 400 && res.statusCode < 500) window5m.errors4xx++;
    if (res.statusCode >= 500) window5m.errors5xx++;
  });
  next();
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 根据 Cloudflare CF-IPCountry 头判断地区
app.get('/api/region', (req, res) => {
  const country = (req.headers['cf-ipcountry'] || '').toUpperCase();
  res.json({ country: country || 'UNKNOWN' });
});

// ── 统计工具函数 ───────────────────────────────────────────
function readLogsInRange(fromTs) {
  const now = Date.now() / 1000;
  // 可能跨月，读所有相关文件
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

function calcStats(entries) {
  const pv  = entries.filter(e => e.path === '/').length;
  const uv  = new Set(entries.filter(e => e.path === '/').map(e => e.ip)).size;
  return { pv, uv };
}

function topPaths(entries, n=3) {
  const cnt = {};
  entries.forEach(e => { cnt[e.path] = (cnt[e.path]||0) + 1; });
  return Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,n);
}

function startOfDay(d)   { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()/1000; }
function startOfWeek(d)  { const c=new Date(d); c.setDate(d.getDate()-d.getDay()); return startOfDay(c); }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1).getTime()/1000; }

// ── 5分钟定时推送 ──────────────────────────────────────────
function report() {
  const now = new Date();
  const w   = window5m;
  window5m  = { reqs:[], errors4xx:0, errors5xx:0 };  // 清零

  const reqs5m = w.reqs;
  const ips5m  = new Set(reqs5m.map(e=>e.ip)).size;
  const pv5m   = reqs5m.filter(e=>e.path==='/').length;
  const top    = topPaths(reqs5m);

  // 日/周/月统计（读日志文件）
  const dayEntries   = readLogsInRange(startOfDay(now));
  const weekEntries  = readLogsInRange(startOfWeek(now));
  const monthEntries = readLogsInRange(startOfMonth(now));
  const dayS   = calcStats(dayEntries);
  const weekS  = calcStats(weekEntries);
  const monthS = calcStats(monthEntries);

  const pad = n => String(n).padStart(2,'0');
  const timeStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const topStr = top.length
    ? top.map(([p,c])=>`  ${p} ×${c}`).join('\n')
    : '  (无请求)';

  const msg =
`📊 <b>OpenClawZoo 监控报告</b>
🕐 ${timeStr}

<b>【过去5分钟】</b>
请求: ${reqs5m.length}  IP: ${ips5m}  PV: ${pv5m}
错误: ${w.errors4xx+w.errors5xx} (4xx:${w.errors4xx}  5xx:${w.errors5xx})
Top路径:
${topStr}

<b>【累计统计】</b>
今日  PV: ${dayS.pv.toLocaleString()}   UV: ${dayS.uv.toLocaleString()}
本周  PV: ${weekS.pv.toLocaleString()}   UV: ${weekS.uv.toLocaleString()}
本月  PV: ${monthS.pv.toLocaleString()}   UV: ${monthS.uv.toLocaleString()}`;

  sendTelegram(msg);
  pruneOldLogs();
}

setInterval(report, 5 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`OpenClawHub running at http://localhost:${PORT}`);
});
