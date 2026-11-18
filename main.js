const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

// Where Eaglercraft installs are stored: resources/app/mc
const MC_ROOT = path.join(app.getAppPath(), 'mc');

let mainWindow = null;
let staticServer = null;
let mcPort = null;

// Resolve a path and ensure it stays inside the specified root.
function resolveInside(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolvedPath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Invalid path');
  }

  return resolvedPath;
}

// ---------- IPC: file saving ----------

ipcMain.handle('save-file', async (_event, relPath, data) => {
  if (typeof relPath !== 'string') {
    throw new Error('Invalid path');
  }

  // Strip leading ./ and mc/ so files don't end up in mc/mc.
  const cleanPath = relPath
    .replace(/^\.?\/?/, '')
    .replace(/^mc\//, '');

  const fullPath = resolveInside(MC_ROOT, cleanPath);

  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, Buffer.from(data));
  return true;
});

// ---------- IPC: wipe contents of mc (keeps the folder) ----------

ipcMain.handle('wipe-mc', async () => {
  if (!fs.existsSync(MC_ROOT)) {
    fs.mkdirSync(MC_ROOT, { recursive: true });
    return true;
  }

  for (const entry of fs.readdirSync(MC_ROOT)) {
    fs.rmSync(path.join(MC_ROOT, entry), {
      recursive: true,
      force: true
    });
  }

  return true;
});

// ---------- IPC: wipe installation ----------

ipcMain.handle('delete-folder', (_event, relPath) => {
  if (typeof relPath !== 'string') {
    return { ok: false, error: 'Invalid path' };
  }

  try {
    const target = resolveInside(app.getAppPath(), relPath);
    fs.rmSync(target, { recursive: true, force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ---------- IPC: give the renderer the local server address ----------

ipcMain.handle('get-mc-base', () => {
  if (!mcPort) {
    throw new Error('The local server is not running');
  }

  return `http://127.0.0.1:${mcPort}`;
});

// ---------- Local static server for installs ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function startStaticServer() {
  return new Promise((resolve, reject) => {
    staticServer = http.createServer((req, res) => {
      let urlPath;

      try {
        urlPath = decodeURIComponent(
          new URL(req.url, 'http://localhost').pathname
        );
      } catch {
        res.writeHead(400);
        res.end('Bad request');
        return;
      }

      if (urlPath.endsWith('/')) {
        urlPath += 'index.html';
      }

      // Remove the URL's leading slash before resolving it under MC_ROOT.
      const relativePath = urlPath.replace(/^\/+/, '');

      let filePath;
      try {
        filePath = resolveInside(MC_ROOT, relativePath);
      } catch {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        res.writeHead(200, {
          'Content-Type':
            MIME[path.extname(filePath).toLowerCase()] ||
            'application/octet-stream'
        });
        res.end(data);
      });
    });

    staticServer.once('error', reject);

    // Port 0 lets the OS choose an available port.
    staticServer.listen(0, '127.0.0.1', () => {
      staticServer.removeListener('error', reject);
      resolve(staticServer.address().port);
    });
  });
}

function stopServer() {
  if (!staticServer) return;

  if (typeof staticServer.closeAllConnections === 'function') {
    staticServer.closeAllConnections();
  }

  staticServer.close();
  staticServer = null;
  mcPort = null;
}

// ---------- Main window ----------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.setZoomFactor(0.9);
  });

  mainWindow.webContents.on('enter-html-full-screen', () => {
    mainWindow?.setFullScreen(true);
  });

  mainWindow.webContents.on('leave-html-full-screen', () => {
    mainWindow?.setFullScreen(false);
  });

  // Also make F11 toggle fullscreen as a backup exit.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11' && mainWindow) {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      event.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

// Handle Eaglercraft's beforeunload prompt.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-prevent-unload', async (event) => {
    event.preventDefault();

    const win = contents.getOwnerBrowserWindow();
    if (!win) return;

    const choice = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Quit', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      message: 'Are you sure you want to quit?',
      detail: 'Unsaved progress will be lost.'
    });

    if (choice.response === 0) {
      win.destroy();
    }
  });
});

// ---------- App lifecycle ----------

app.whenReady()
  .then(async () => {
    await fs.promises.mkdir(MC_ROOT, { recursive: true });
    mcPort = await startStaticServer();
    createWindow();
  })
  .catch((err) => {
    console.error('Failed to start application:', err);
    app.quit();
  });

app.on('before-quit', () => {
  stopServer();

  // Force close if a game loop prevents graceful shutdown.
  setTimeout(() => app.exit(0), 2000);
});

app.on('window-all-closed', () => {
  app.quit();
});

/* Package commands
npx electron-packager . BeaconLauncherPC --platform=linux --arch=x64,arm64 --out=build --overwrite --icon=logo.png
npx electron-packager . BeaconLauncherPC --platform=win --arch=x64,arm64 --out=build --overwrite --icon=logo.ico
*/
