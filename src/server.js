'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const chokidar = require('chokidar');
const chalk = require('chalk');
const figlet = require('figlet');
const qrcode = require('qrcode');
const { tunnelmole } = require('tunnelmole');

// ─── Inject live-reload script into HTML responses ────────────────────────────
const LIVERELOAD_SNIPPET = `
<script>
  (function () {
    const ws = new WebSocket('ws://' + location.host + '/__devshare_ws__');
    ws.onmessage = (e) => { if (e.data === 'reload') location.reload(); };
    ws.onclose   = () => setTimeout(() => location.reload(), 1500);
  })();
</script>`;

function injectReload(html) {
  return html.replace(/<\/body>/i, `${LIVERELOAD_SNIPPET}</body>`);
}

// ─── Banner ───────────────────────────────────────────────────────────────────
function banner() {
  const title = figlet.textSync('DevShare', { font: 'Slant' });
  console.log(chalk.cyan(title));
  console.log(chalk.dim('  Local dev server · share · live reload\n'));
}

// ─── Pretty logger ────────────────────────────────────────────────────────────
const log = {
  info  : (msg) => console.log(`  ${chalk.cyan('◆')}  ${msg}`),
  ok    : (msg) => console.log(`  ${chalk.green('✔')}  ${msg}`),
  warn  : (msg) => console.log(`  ${chalk.yellow('⚠')}  ${msg}`),
  error : (msg) => console.log(`  ${chalk.red('✖')}  ${msg}`),
  divider: ()  => console.log(chalk.dim('  ' + '─'.repeat(50))),
};

// ─── Display QR code ──────────────────────────────────────────────────────────
async function showQR(url) {
  console.log('\n' + chalk.bold.magenta('  ▌ Scan to open on any device ▐') + '\n');
  const qrString = await qrcode.toString(url, { type: 'terminal', small: true });
  qrString.split('\n').forEach((line) => console.log('  ' + line));
  console.log();
}

// ─── Core server ──────────────────────────────────────────────────────────────
async function startServer(opts = {}) {
  const {
    port  = 3000,
    dir   = '.',
    share = false,
    qrcode: showQrcode = false,
    open  = false,
    watch = true,
  } = opts;

  const serveDir = path.resolve(process.cwd(), dir);

  banner();
  log.info(`Serving  ${chalk.white(serveDir)}`);
  log.divider();

  // ── Express app ──────────────────────────────────────────────────────────
  const app = express();

  // Middleware: inject live-reload into HTML files
  app.use((req, res, next) => {
    if (!watch) return next();

    const filePath = path.join(serveDir, req.path === '/' ? 'index.html' : req.path);
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.html' || ext === '') {
      // Try index.html for directories
      const target = ext === '' ? path.join(filePath, 'index.html') : filePath;
      if (fs.existsSync(target)) {
        try {
          const html = fs.readFileSync(target, 'utf8');
          res.setHeader('Content-Type', 'text/html');
          return res.send(injectReload(html));
        } catch (_) { /* fall through */ }
      }
    }
    next();
  });

  // Static file serving with directory listing
  app.use(express.static(serveDir, { index: 'index.html' }));

  // Fallback: auto directory listing
  app.use((req, res) => {
    const target = path.join(serveDir, req.path);
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
      const files = fs.readdirSync(target);
      const items = files
        .map((f) => {
          const isDir = fs.statSync(path.join(target, f)).isDirectory();
          return `<li><a href="${req.path}${f}${isDir ? '/' : ''}">${f}${isDir ? '/' : ''}</a></li>`;
        })
        .join('\n');
      res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DevShare – ${req.path}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Courier New',monospace;background:#0d0d0d;color:#e0e0e0;min-height:100vh;padding:40px}
    h1{color:#00e5ff;font-size:1.4rem;margin-bottom:24px;letter-spacing:.08em}
    ul{list-style:none;display:flex;flex-direction:column;gap:8px}
    a{color:#80cbc4;text-decoration:none;font-size:1rem;padding:8px 16px;border:1px solid #1e1e1e;
       display:inline-block;border-radius:4px;transition:all .15s}
    a:hover{color:#00e5ff;border-color:#00e5ff;background:#00e5ff11}
  </style>
</head>
<body>
  <h1>📂 ${req.path}</h1>
  <ul>${items}</ul>
  ${LIVERELOAD_SNIPPET}
</body>
</html>`);
    } else {
      res.status(404).send('<h1>404 – Not Found</h1>');
    }
  });

  // ── HTTP + WebSocket server ───────────────────────────────────────────────
  const server = http.createServer(app);
  const wss    = new WebSocket.Server({ server, path: '/__devshare_ws__' });

  // ── File watcher → broadcast reload ──────────────────────────────────────
  if (watch) {
    const watcher = chokidar.watch(serveDir, {
      ignoreInitial: true,
      ignored: /(^|[/\\])\.(?!$)|node_modules/,
    });

    const broadcast = () => {
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send('reload');
        }
      });
    };

    watcher.on('change', (f) => {
      log.info(`Changed  ${chalk.dim(path.relative(serveDir, f))}`);
      broadcast();
    });
    watcher.on('add',    (f) => { log.ok(`Added    ${chalk.dim(path.relative(serveDir, f))}`); broadcast(); });
    watcher.on('unlink', (f) => { log.warn(`Removed  ${chalk.dim(path.relative(serveDir, f))}`); broadcast(); });
  }

  // ── Start listening ───────────────────────────────────────────────────────
  await new Promise((resolve) => server.listen(port, resolve));

  const localURL = `http://localhost:${port}`;
  log.ok(`Local    ${chalk.white.underline(localURL)}`);

  // ── Open browser ──────────────────────────────────────────────────────────
  if (open) {
    const opener = process.platform === 'darwin' ? 'open'
                 : process.platform === 'win32'  ? 'start'
                 : 'xdg-open';
    require('child_process').exec(`${opener} ${localURL}`);
  }

  // ── Public tunnel ─────────────────────────────────────────────────────────
  if (share) {
    log.divider();
    log.info(chalk.yellow('Creating public tunnel…'));

    try {
      const shareURL = await tunnelmole({ port });

      log.ok(`Share    ${chalk.green.underline(shareURL)}`);
      log.divider();

      if (showQrcode) await showQR(shareURL);

      process.on('SIGINT', () => {
        log.warn('Shutting down…');
        server.close(() => process.exit(0));
      });

    } catch (err) {
      log.error(`Tunnel failed: ${err.message}`);
      log.warn('Running locally only.');
    }
  } else {
    log.divider();
    log.info(chalk.dim('Tip: run with --share --qrcode to go public 🌍'));
    log.divider();

    process.on('SIGINT', () => {
      server.close(() => process.exit(0));
    });
  }

  if (watch) log.info(chalk.dim('Watching for changes… (live reload active)'));
  console.log();
}

module.exports = { startServer };
