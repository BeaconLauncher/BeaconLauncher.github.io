const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { dialog } = require('electron');

// Where Eaglercraft installs are stored: resources/app/mc
const MC_ROOT = path.join(app.getAppPath(), 'mc');

let mainWindow = null;
let staticServer = null;
let mcPort = null;

// ---------- IPC: file saving ----------

ipcMain.handle('save-file', async (event, relPath, data) => {
  // Strip leading ./ and mc/ so files don't end up in mc/mc
  const cleanPath = relPath.replace(/^\.?\/?/, '').replace(/^mc\//, '');
  const fullPath = path.normalize(path.join(MC_ROOT, cleanPath));

  if (!fullPath.startsWith(MC_ROOT)) {
    throw new Error('Invalid path: ' + relPath);
  }

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
    fs.rmSync(path.join(MC_ROOT, entry), { recursive: true, force: true });
  }
  return true;
});

// ---------- IPC: wipe installation ----------

ipcMain.handle('delete-folder', (event, relPath) => {
    const target = path.join(app.getAppPath(), relPath);

	console.log("deleting from main.js")
	
    try {
        fs.rmSync(target, { recursive: true, force: true });
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

// ---------- IPC: give the renderer the local server address ----------

ipcMain.handle('get-mc-base', () => `http://127.0.0.1:${mcPort}`);

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
  return new Promise((resolve) => {
    staticServer = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (urlPath.endsWith('/')) urlPath += 'index.html';

      const filePath = path.normalize(path.join(MC_ROOT, urlPath));
      if (!filePath.startsWith(MC_ROOT)) {
        res.writeHead(403);
        return res.end('Forbidden');
      }

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          return res.end('Not found');
        }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
        });
        res.end(data);
      });
    });

    // Port 0 lets the OS pick a free port
    staticServer.listen(8498, '127.0.0.1', () => {
      resolve(staticServer.address().port);
    });
  });
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
    mainWindow.webContents.setZoomFactor(0.9);
  });
  
function stopServer() {
  if (staticServer) {
    staticServer.closeAllConnections();
    staticServer.close();
    staticServer = null;
    app.quit()
  }
}

app.on('web-contents-created', (event, contents) => {
  contents.on('will-prevent-unload', async (e) => {
    e.preventDefault(); // stop Eaglercraft's own block...

    const win = e.sender.getOwnerBrowserWindow();
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
      win.destroy(); // destroy() closes without triggering beforeunload again
    }
  });
});

app.on('before-quit', () => {
  stopServer();
});

app.on('window-all-closed', () => {
  stopServer();
  app.exit(0);
});

  mainWindow.on('closed', () => {
    mainWindow = null;
    app.quit();
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

mainWindow.webContents.on('enter-html-full-screen', () => {
  mainWindow.setFullScreen(true);
});

mainWindow.webContents.on('leave-html-full-screen', () => {
  mainWindow.setFullScreen(false);
});

// Also make F11 toggle fullscreen as a backup exit
mainWindow.webContents.on('before-input-event', (event, input) => {
  if (input.type === 'keyDown' && input.key === 'F11') {
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    event.preventDefault();
  }
});

// ---------- App lifecycle ----------

app.whenReady().then(async () => {
  mcPort = await startStaticServer();
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  if (staticServer) staticServer.close();

  // Force close if a game loop freezes the graceful shutdown
  setTimeout(() => app.exit(0), 2000);
});

/*
npx electron-packager . BeaconLauncherPC --platform=linux --arch=x64,arm64 --out=build --overwrite --icon=logo.png
npx electron-packager . BeaconLauncherPC --platform=win --arch=x64,arm64 --out=build --overwrite --icon=logo.ico
*/
