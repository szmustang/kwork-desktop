const { spawn, execFile } = require('child_process');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { EventEmitter } = require('events');

let sidecarProcess = null;
let cachedServerInfo = null;
const childPids = new Set(); // track all spawned child PIDs for cleanup

const KCODE_DIR = path.join(process.env.HOME || os.homedir(), '.kcode');
const SERVER_JSON_PATH = path.join(KCODE_DIR, 'server.json');
const UPDATES_DIR = path.join(KCODE_DIR, 'updates');
const UPDATE_PENDING_PATH = path.join(UPDATES_DIR, 'update-pending.json');
const DOWNLOAD_DIR = path.join(UPDATES_DIR, 'download');
const CDN_BASE = 'http://tdmrxr8op.hn-bkt.clouddn.com/opencode';

/* ── Install event emitter (main.cjs listens for progress) ── */
const installEvents = new EventEmitter();

/* ── Install state (shared across calls for concurrency safety) ── */
let installState = {
  status: 'idle',      // idle | downloading | installing | done | error
  progress: 0,         // download percentage 0-100
  error: null,
  promise: null,       // current install promise (concurrency lock)
};

/* ── Paths ── */

function getAppBinDir() {
  const isDev = !!process.env.VITE_DEV_SERVER_URL;
  if (isDev) {
    return path.join(__dirname, 'bin');
  }
  // Production: use persistent writable path outside .app bundle
  // .app/Contents/Resources is read-only (code signing / App Translocation)
  const binDir = path.join(KCODE_DIR, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  return binDir;
}

function getAppDataDir() {
  const isDev = !!process.env.VITE_DEV_SERVER_URL;
  if (isDev) {
    const dataDir = path.join(__dirname, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    return dataDir;
  }
  // Production: use persistent writable path under ~/.kcode/data
  const dataDir = path.join(KCODE_DIR, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

function getOpencodeBinPath() {
  const binDir = getAppBinDir();
  const exe = process.platform === 'win32' ? 'opencode.exe' : 'opencode';
  return path.join(binDir, exe);
}

/* ── CDN Download Logic ── */

/**
 * Get platform key for latest.json lookup.
 * Returns e.g. 'darwin-arm64', 'darwin-x64', 'windows-x64'
 */
function getPlatformKey() {
  const p = process.platform === 'win32' ? 'windows' : process.platform;
  return `${p}-${process.arch}`;
}

/**
 * Fetch JSON from a URL (supports http/https).
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON from ' + url)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout fetching ' + url)); });
  });
}

/**
 * Download a file with progress reporting.
 * Returns the local file path.
 */
function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 60000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // follow redirect
        res.resume();
        return downloadFile(res.headers.location, destPath, onProgress).then(resolve, reject);
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
      }
      const total = parseInt(res.headers['content-length'], 10) || 0;
      let downloaded = 0;
      const file = fs.createWriteStream(destPath);
      res.on('data', (chunk) => {
        downloaded += chunk.length;
        if (total > 0 && onProgress) {
          onProgress(Math.round((downloaded / total) * 100));
        }
      });
      res.pipe(file);
      file.on('finish', () => { file.close(() => resolve(destPath)); });
      file.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    });
    req.on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
    req.on('timeout', () => {
      req.destroy();
      fs.unlink(destPath, () => {});
      reject(new Error('Download timeout'));
    });
  });
}

/**
 * Full install flow: fetch latest.json → download → verify → extract → cleanup.
 * Emits events on installEvents for UI progress.
 * Uses installState.promise as a concurrency lock.
 */
function installOpencode() {
  // Concurrency lock: if already running, return the existing promise
  if (installState.promise) {
    console.log('[Sidecar] installOpencode() already in progress, reusing promise');
    return installState.promise;
  }

  const p = _doInstallOpencode();
  installState.promise = p;
  p.finally(() => { installState.promise = null; });
  return p;
}

async function _doInstallOpencode() {
  const platformKey = getPlatformKey();
  console.log('[Sidecar] Installing opencode for platform:', platformKey);

  // 清除旧的 opencode 二进制（如果存在），确保全新安装
  const binDir = path.join(KCODE_DIR, 'bin');
  const exeName = process.platform === 'win32' ? 'opencode.exe' : 'opencode';
  const existingBin = path.join(binDir, exeName);
  if (fs.existsSync(existingBin)) {
    try {
      fs.unlinkSync(existingBin);
      console.log('[Sidecar] Removed existing opencode at', existingBin);
    } catch (err) {
      console.warn('[Sidecar] Failed to remove existing opencode:', err.message);
    }
  }

  // Update state: downloading
  installState.status = 'downloading';
  installState.progress = 0;
  installState.error = null;
  installEvents.emit('progress', { status: 'downloading', progress: 0 });

  try {
    // 1. Fetch latest.json
    const latestUrl = `${CDN_BASE}/latest.json`;
    console.log('[Sidecar] Fetching', latestUrl);
    let latest;
    try {
      latest = await fetchJson(latestUrl);
    } catch (err) {
      throw new Error('无法获取版本信息: ' + err.message);
    }

    // 2. Match platform
    const fileInfo = latest.files && latest.files[platformKey];
    if (!fileInfo) {
      throw new Error(`当前平台 ${platformKey} 暂不支持，请联系管理员`);
    }

    const assetName = fileInfo.name;
    const expectedSha256 = (fileInfo.sha256 || '').toLowerCase();
    const downloadUrl = `${CDN_BASE}/${assetName}`;
    const localPath = path.join(DOWNLOAD_DIR, assetName);

    console.log('[Sidecar] Downloading', downloadUrl, '→', localPath);

    // 3. Download
    await downloadFile(downloadUrl, localPath, (percent) => {
      installState.progress = percent;
      installEvents.emit('progress', { status: 'downloading', progress: percent });
    });

    // 4. SHA256 verify
    installState.status = 'installing';
    installState.progress = 100;
    installEvents.emit('progress', { status: 'installing', progress: 100 });
    console.log('[Sidecar] Download complete, verifying SHA256...');

    if (expectedSha256) {
      const computed = sha256File(localPath);
      if (computed !== expectedSha256) {
        // Clean up bad file
        try { fs.unlinkSync(localPath); } catch (_) {}
        throw new Error('文件校验失败 (SHA256 不匹配)，请重试');
      }
      console.log('[Sidecar] SHA256 OK');
    }

    // 5. Extract
    console.log('[Sidecar] Extracting...');
    const binDir = path.join(KCODE_DIR, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const exeName = process.platform === 'win32' ? 'opencode.exe' : 'opencode';
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-install-'));

    try {
      await extractArchive(localPath, tmpDir);
      const extracted = findFile(tmpDir, exeName);
      if (!extracted) throw new Error('压缩包中未找到 opencode 可执行文件');

      const destBin = path.join(binDir, exeName);
      fs.copyFileSync(extracted, destBin);
      if (process.platform !== 'win32') fs.chmodSync(destBin, 0o755);
      console.log('[Sidecar] Installed opencode to', destBin);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    // 6. Cleanup download file
    try {
      fs.unlinkSync(localPath);
      // Remove download dir if empty
      const remaining = fs.readdirSync(DOWNLOAD_DIR);
      if (remaining.length === 0) fs.rmdirSync(DOWNLOAD_DIR);
    } catch (_) {}

    installState.status = 'done';
    installState.error = null;
    installEvents.emit('progress', { status: 'done', progress: 100 });
    console.log('[Sidecar] opencode install complete');
    return { success: true };

  } catch (err) {
    console.error('[Sidecar] Install failed:', err.message);
    installState.status = 'error';
    installState.error = err.message;
    installEvents.emit('progress', { status: 'error', error: err.message });
    return { success: false, error: err.message };
  }
}

/* ── Check if opencode is installed ── */

function isOpencodeInstalled() {
  const binPath = getOpencodeBinPath();
  return fs.existsSync(binPath);
}

/**
 * Get the current install state (for UI polling).
 */
function getInstallState() {
  return {
    status: installState.status,
    progress: installState.progress,
    error: installState.error,
  };
}

function getOpencodeVersion() {
  return new Promise((resolve) => {
    if (!isOpencodeInstalled()) return resolve(null);
    const child = execFile(getOpencodeBinPath(), ['--version'], { timeout: 5000 }, (err, stdout) => {
      childPids.delete(child.pid);
      if (err) return resolve(null);
      resolve(stdout.trim());
    });
    if (child.pid) childPids.add(child.pid);
  });
}

/* ── Archive Utilities ── */

function extractArchive(archivePath, destDir) {
  return new Promise((resolve, reject) => {
    let cmd, args;
    if (process.platform === 'win32') {
      cmd = 'powershell';
      args = ['-Command', `Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force`];
    } else if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
      cmd = 'tar';
      args = ['-xzf', archivePath, '-C', destDir];
    } else {
      cmd = 'unzip';
      args = ['-o', archivePath, '-d', destDir];
    }
    const child = spawn(cmd, args, { stdio: 'pipe' });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`extract exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

function findFile(dir, name) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === name) return fullPath;
    if (entry.isDirectory()) {
      const found = findFile(fullPath, name);
      if (found) return found;
    }
  }
  return null;
}

/* ── Pending Update (written by opencode, applied by shell) ── */

/**
 * Normalize version string: strip leading 'v', trim whitespace.
 */
function normalizeVersion(v) {
  if (!v) return '';
  return v.replace(/^v/i, '').trim();
}

/**
 * Compare two semver-like version strings.
 * Returns  1 if a > b, -1 if a < b, 0 if equal.
 */
function compareVersions(a, b) {
  const pa = normalizeVersion(a).split('.').map(Number);
  const pb = normalizeVersion(b).split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/**
 * Compute SHA256 hex digest of a file.
 */
function sha256File(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Apply a pending update if update-pending.json exists and contains
 * a version newer than the currently installed opencode binary.
 *
 * Flow (per host-integration.md §5.3):
 *  1. Read ~/.kcode/updates/update-pending.json
 *  2. Get current local version via  opencode --version
 *  3. If pending version > local version:
 *     a. SHA256 verify the downloaded archive
 *     b. Extract → replace ~/.kcode/bin/opencode
 *     c. Clean up pending marker & download dir
 *  4. Otherwise skip (pending version <= local) and clean up stale marker
 */
async function applyPendingUpdate() {
  // 1. Check existence
  if (!fs.existsSync(UPDATE_PENDING_PATH)) {
    console.log('[Sidecar] No pending update');
    return { applied: false };
  }

  // 2. Parse
  let pending;
  try {
    pending = JSON.parse(fs.readFileSync(UPDATE_PENDING_PATH, 'utf-8'));
  } catch (err) {
    console.error('[Sidecar] Bad update-pending.json:', err.message);
    cleanupPendingUpdate();
    return { applied: false, error: 'parse_error' };
  }

  const { version: pendingVer, binary, sha256, forced } = pending;
  console.log('[Sidecar] Pending update v' + pendingVer, '| binary:', binary, '| forced:', forced);

  // 3. Compare with local version
  const currentVer = await getOpencodeVersion();
  if (currentVer && compareVersions(pendingVer, currentVer) <= 0) {
    console.log('[Sidecar] Pending v' + pendingVer, '<= local v' + currentVer + ', skipping');
    cleanupPendingUpdate();
    return { applied: false, reason: 'not_newer' };
  }
  console.log('[Sidecar] Updating: local v' + (currentVer || 'unknown'), '→ v' + pendingVer);

  // 4. Verify archive exists
  if (!binary || !fs.existsSync(binary)) {
    console.error('[Sidecar] Archive not found:', binary);
    cleanupPendingUpdate();
    return { applied: false, error: 'archive_missing' };
  }

  // 5. SHA256 verification
  if (sha256) {
    const computed = sha256File(binary);
    if (computed !== sha256.toLowerCase()) {
      console.error('[Sidecar] SHA256 mismatch! expected:', sha256, 'got:', computed);
      cleanupPendingUpdate();
      return { applied: false, error: 'sha256_mismatch' };
    }
    console.log('[Sidecar] SHA256 OK');
  }

  // 6. Extract and replace
  const binDir = getAppBinDir();
  const exeName = process.platform === 'win32' ? 'opencode.exe' : 'opencode';
  const destBin = path.join(binDir, exeName);
  const backupPath = destBin + '.bak';

  // Backup old binary
  try {
    if (fs.existsSync(destBin)) {
      fs.copyFileSync(destBin, backupPath);
    }
  } catch (err) {
    console.warn('[Sidecar] Backup failed:', err.message);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-update-'));
  try {
    await extractArchive(binary, tmpDir);
    const extracted = findFile(tmpDir, exeName);
    if (!extracted) throw new Error('opencode binary not found in archive');

    fs.copyFileSync(extracted, destBin);
    if (process.platform !== 'win32') fs.chmodSync(destBin, 0o755);

    console.log('[Sidecar] Updated opencode to v' + pendingVer);
    cleanupPendingUpdate();
    try { fs.unlinkSync(backupPath); } catch (_) {}
    return { applied: true, version: pendingVer };
  } catch (err) {
    console.error('[Sidecar] Update failed:', err.message);
    // Rollback
    try {
      if (fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, destBin);
        if (process.platform !== 'win32') fs.chmodSync(destBin, 0o755);
        console.log('[Sidecar] Rolled back to previous binary');
      }
    } catch (rbErr) {
      console.error('[Sidecar] Rollback failed:', rbErr.message);
    }
    cleanupPendingUpdate();
    return { applied: false, error: 'extract_failed' };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Remove update-pending.json and clean download directory.
 */
function cleanupPendingUpdate() {
  try {
    if (fs.existsSync(UPDATE_PENDING_PATH)) fs.unlinkSync(UPDATE_PENDING_PATH);
  } catch (err) {
    console.warn('[Sidecar] Failed to remove update-pending.json:', err.message);
  }
  const dlDir = path.join(UPDATES_DIR, 'download');
  try {
    if (fs.existsSync(dlDir)) fs.rmSync(dlDir, { recursive: true, force: true });
  } catch (err) {
    console.warn('[Sidecar] Failed to clean download dir:', err.message);
  }
}

/**
 * Check if there's a pending update available.
 * Returns { hasUpdate: boolean, version?: string, currentVersion?: string }
 */
async function checkPendingUpdate() {
  // 1. Check existence
  if (!fs.existsSync(UPDATE_PENDING_PATH)) {
    return { hasUpdate: false };
  }

  // 2. Parse
  let pending;
  try {
    pending = JSON.parse(fs.readFileSync(UPDATE_PENDING_PATH, 'utf-8'));
  } catch (err) {
    console.error('[Sidecar] Bad update-pending.json:', err.message);
    return { hasUpdate: false, error: 'parse_error' };
  }

  const { version: pendingVer } = pending;
  
  // 3. Compare with local version
  const currentVer = await getOpencodeVersion();
  if (currentVer && compareVersions(pendingVer, currentVer) <= 0) {
    return { hasUpdate: false, version: pendingVer, currentVersion: currentVer };
  }
  
  return { hasUpdate: true, version: pendingVer, currentVersion: currentVer };
}

/* ── Server Info & Health ── */

/**
 * Sync auth.json from default ~/.local/share/opencode/ to app data dir
 * so the sidecar (with custom XDG_DATA_HOME) can still read API keys.
 */
function syncAuthFile(appDataDir) {
  const defaultAuthPath = path.join(
    process.env.HOME || os.homedir(),
    '.local', 'share', 'opencode', 'auth.json'
  );
  const targetDir = path.join(appDataDir, 'opencode');
  const targetAuthPath = path.join(targetDir, 'auth.json');

  try {
    if (fs.existsSync(defaultAuthPath)) {
      fs.mkdirSync(targetDir, { recursive: true });
      fs.copyFileSync(defaultAuthPath, targetAuthPath);
      console.log('[Sidecar] Synced auth.json to', targetAuthPath);
    } else {
      console.log('[Sidecar] No default auth.json found at', defaultAuthPath);
    }
  } catch (err) {
    console.warn('[Sidecar] Failed to sync auth.json:', err.message);
  }
}

/**
 * Read server.json written by opencode kcode-serve.
 * Returns { port, token, pid, version, startedAt } or null.
 */
function readServerJson() {
  try {
    if (fs.existsSync(SERVER_JSON_PATH)) {
      const content = fs.readFileSync(SERVER_JSON_PATH, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.warn('[Sidecar] Failed to read server.json:', err.message);
  }
  return null;
}

function getServerInfo() {
  if (cachedServerInfo) return cachedServerInfo;
  const serverJson = readServerJson();
  if (serverJson) {
    cachedServerInfo = {
      url: `http://127.0.0.1:${serverJson.port}`,
      token: serverJson.token,
      pid: serverJson.pid,
      version: serverJson.version,
    };
    return cachedServerInfo;
  }
  return { url: null, token: null };
}

function checkHealth() {
  return new Promise((resolve) => {
    const info = getServerInfo();
    if (!info.url) return resolve(false);
    const headers = { timeout: 3000 };
    if (info.token) headers.headers = { 'Authorization': `Bearer ${info.token}` };
    const req = http.get(
      `${info.url}/session`,
      headers,
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function waitForServerJson(maxRetries = 30, interval = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    cachedServerInfo = null; // force re-read
    const serverJson = readServerJson();
    if (serverJson && serverJson.port && serverJson.token) {
      cachedServerInfo = {
        url: `http://127.0.0.1:${serverJson.port}`,
        token: serverJson.token,
        pid: serverJson.pid,
        version: serverJson.version,
      };
      // Verify health with token
      const healthy = await checkHealth();
      if (healthy) return true;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
}

/* ── Start / Kill Sidecar ── */

async function startSidecar() {
  if (sidecarProcess) return getServerInfo();

  // Apply pending update before launching (opencode writes update-pending.json)
  try {
    const updateResult = await applyPendingUpdate();
    if (updateResult.applied) {
      console.log('[Sidecar] Applied pending update to v' + updateResult.version);
    }
  } catch (err) {
    console.warn('[Sidecar] applyPendingUpdate error (continuing):', err.message);
  }

  // Check if already running via server.json
  cachedServerInfo = null; // force re-read
  const serverJson = readServerJson();
  if (serverJson && serverJson.pid) {
    try {
      process.kill(serverJson.pid, 0); // check if process alive
      console.log('[Sidecar] Process', serverJson.pid, 'is alive, verifying HTTP on port', serverJson.port);
      cachedServerInfo = {
        url: `http://127.0.0.1:${serverJson.port}`,
        token: serverJson.token,
        pid: serverJson.pid,
        version: serverJson.version,
      };
      // PID alive is not enough — verify HTTP is actually responding
      const healthy = await checkHealth();
      if (healthy) {
        console.log('[Sidecar] Server verified healthy on port', serverJson.port);
        return getServerInfo();
      }
      // Process alive but HTTP not ready — wait a bit and retry
      console.log('[Sidecar] Process alive but HTTP not ready, waiting...');
      const becameReady = await waitForServerJson(10, 1000);
      if (becameReady) {
        console.log('[Sidecar] Server became healthy on port', getServerInfo().url);
        return getServerInfo();
      }
      // Still not healthy — treat as stale, kill and restart
      console.warn('[Sidecar] Process', serverJson.pid, 'not responding, killing and restarting');
      try { process.kill(serverJson.pid, 'SIGTERM'); } catch (_k) { /* ignore */ }
      cachedServerInfo = null;
    } catch (_) {
      // PID dead, stale server.json — continue to start
      console.log('[Sidecar] Stale server.json found, pid', serverJson.pid, 'is dead');
      cachedServerInfo = null;
    }
  }

  const binPath = getOpencodeBinPath();
  if (!fs.existsSync(binPath)) {
    throw new Error('opencode not installed');
  }

  console.log('[Sidecar] Starting opencode serve from', binPath);

  try {
    const dataDir = getAppDataDir();

    // Sync auth.json from default location so sidecar can access API keys
    syncAuthFile(dataDir);

    const env = {
      ...process.env,
      // Use app-local data dir so sessions are isolated
      XDG_DATA_HOME: dataDir,
    };
    sidecarProcess = spawn(binPath, ['kcode-serve'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    sidecarProcess.stdout.on('data', (data) => {
      console.log('[Sidecar]', data.toString().trim());
    });

    sidecarProcess.stderr.on('data', (data) => {
      console.error('[Sidecar]', data.toString().trim());
    });

    sidecarProcess.on('exit', (code) => {
      console.log('[Sidecar] Process exited with code:', code);
      sidecarProcess = null;
    });

    sidecarProcess.on('error', (err) => {
      console.error('[Sidecar] Failed to start:', err.message);
      sidecarProcess = null;
    });

    // Wait for server.json to appear then check health
    const ready = await waitForServerJson();
    if (ready) {
      const info = getServerInfo();
      console.log('[Sidecar] Server ready on', info.url);
    } else {
      console.warn('[Sidecar] Server did not become healthy in time');
    }
  } catch (err) {
    console.error('[Sidecar] Spawn error:', err);
  }

  return getServerInfo();
}

function forceKill(pid) {
  try {
    process.kill(pid, 'SIGKILL');
    console.log('[Sidecar] SIGKILL sent to pid:', pid);
  } catch (_) { /* already dead */ }
}

function killSidecar() {
  const pidsToKill = new Set();

  // 1. Collect spawned sidecar process PID
  if (sidecarProcess) {
    console.log('[Sidecar] Killing spawned process pid:', sidecarProcess.pid);
    pidsToKill.add(sidecarProcess.pid);
    sidecarProcess = null;
  }

  // 2. Collect process recorded in server.json (may be external or orphaned)
  try {
    const serverJson = readServerJson();
    if (serverJson && serverJson.pid) {
      pidsToKill.add(serverJson.pid);
    }
  } catch (_) { /* ignore */ }

  // 3. Kill all collected PIDs — SIGKILL directly (we're exiting, no time for graceful)
  for (const pid of pidsToKill) {
    try {
      process.kill(pid, 0); // check alive
      console.log('[Sidecar] Killing pid:', pid);
      process.kill(pid, 'SIGKILL');
    } catch (_) { /* already dead */ }
  }

  // 4. Kill any tracked child processes (e.g. --version calls)
  for (const pid of childPids) {
    try {
      process.kill(pid, 'SIGKILL');
      console.log('[Sidecar] Killed tracked child pid:', pid);
    } catch (_) { /* already dead */ }
  }
  childPids.clear();

  // 5. Clean up server.json to avoid stale entries
  try {
    if (fs.existsSync(SERVER_JSON_PATH)) {
      fs.unlinkSync(SERVER_JSON_PATH);
      console.log('[Sidecar] Removed server.json');
    }
  } catch (err) {
    console.warn('[Sidecar] Failed to remove server.json:', err.message);
  }

  cachedServerInfo = null;
}

module.exports = {
  startSidecar,
  killSidecar,
  getServerInfo,
  isOpencodeInstalled,
  getOpencodeVersion,
  applyPendingUpdate,
  checkPendingUpdate,
  getAppBinDir,
  installOpencode,
  getInstallState,
  installEvents,
};
