const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { chromium } = require('playwright-core');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static('public'));

let browser = null;
let page = null;
let running = false;
let clients = new Set();

function broadcast(data) {
  const msg = JSON.stringify(data);
  clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

function log(text, type = 'info') {
  broadcast({ type: 'log', text, logType: type, ts: new Date().toLocaleTimeString('ar-EG') });
}

function progress(done, total) {
  broadcast({ type: 'progress', done, total, pct: total ? Math.round((done/total)*100) : 0 });
}

wss.on('connection', ws => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});

async function launchBrowser() {
  if (browser) return;
  log('جاري تشغيل المتصفح...', 'info');
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  log('المتصفح جاهز ✓', 'success');
  broadcast({ type: 'browser', state: 'ready' });
}

async function doLogin(studentId, password) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0',
    locale: 'ja-JP'
  });
  page = await context.newPage();
  log('فتح صفحة تسجيل الدخول...', 'info');
  await page.goto('https://qureo.jp/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('input', { timeout: 10000 });

  const inputs = await page.$$('input:not([type="hidden"])');
  let filled = 0;
  for (const inp of inputs) {
    const type = await inp.getAttribute('type');
    const name = (await inp.getAttribute('name') || '').toLowerCase();
    if (type === 'password') {
      await inp.fill(password); filled++;
    } else if (type === 'text' || type === 'email' || !type || name.match(/user|id|login|student/)) {
      await inp.fill(String(studentId)); filled++;
    }
    if (filled >= 2) break;
  }

  const submitBtn = await page.$('button[type="submit"], input[type="submit"]');
  if (submitBtn) await submitBtn.click();
  else await page.keyboard.press('Enter');

  await page.waitForURL(url => !url.includes('/login'), { timeout: 15000 });
  log('تم تسجيل الدخول بنجاح ✓', 'success');
  return page.url();
}

async function navigateToCourse(courseId) {
  log(`جار
