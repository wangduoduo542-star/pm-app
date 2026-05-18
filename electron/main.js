/**
 * 装修项目管家 - Electron 桌面端
 * 包装 Web 应用 + 内置局域网同步服务器
 */

const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, ipcMain } = require('electron');
const path = require('path');
const { fork } = require('child_process');

let mainWindow = null;
let tray = null;
let serverProcess = null;
const SERVER_PORT = 3456;

// 启动同步服务器（独立进程）
function startServer() {
  const serverPath = path.join(__dirname, '..', 'server.js');
  serverProcess = fork(serverPath, [], {
    stdio: 'pipe',
    env: { ...process.env, PORT: String(SERVER_PORT) }
  });
  serverProcess.stdout.on('data', data => console.log(`[Server] ${data}`));
  serverProcess.stderr.on('data', data => console.error(`[Server] ${data}`));
  serverProcess.on('exit', code => console.log(`[Server] exited with code ${code}`));
  console.log('[Electron] Sync server started');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 780,
    minWidth: 360,
    minHeight: 600,
    icon: path.join(__dirname, '..', 'icons', 'icon-512.png'),
    title: '装修项目管家',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    autoHideMenuBar: true,
    show: false,
  });

  // 加载本地 Web 应用
  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'icons', 'icon-512.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });

  tray = new Tray(icon);
  tray.setToolTip('装修项目管家');

  const contextMenu = Menu.buildFromTemplate([
    { label: '打开窗口', click: () => mainWindow && mainWindow.show() },
    { label: '服务器地址', click: () => {
      const ip = require('os').networkInterfaces();
      let addr = 'localhost';
      for (const name of Object.keys(ip)) {
        for (const iface of ip[name]) {
          if (iface.family === 'IPv4' && !iface.internal) addr = iface.address;
        }
      }
      dialog.showMessageBox({ type: 'info', title: '局域网地址', message: `http://${addr}:${SERVER_PORT}` });
    }},
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => mainWindow && mainWindow.show());
}

app.whenReady().then(() => {
  startServer();
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
