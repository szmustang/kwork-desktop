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
let resolvedShellEnv = null; // cached shell environment (PATH etc.) from login shell

const KCODE_DIR = path.join(process.env.HOME || os.homedir(), '.kcode');
const SERVER_JSON_PATH = path.join(KCODE_DIR, 'server.json');
const UPDATES_DIR = path.join(KCODE_DIR, 'updates');
const UPDATE_PENDING_PATH = path.join(UPDATES_DIR, 'update-pending.json');
const DOWNLOAD_DIR = path.join(UPDATES_DIR, 'download');
const DOWNLOAD_META_PATH = path.join(DOWNLOAD_DIR, '.download-meta.json');
const UPDATER_LOG_PATH = path.join(UPDATES_DIR, 'updater.log');
const CDN_BASE = 'http://app.cosmicstudio.cn/cosmicai/lingee/update/opencode';

/* ── Updater Logger ── */

/**
 * Append a timestamped log line to ~/.kcode/updates/updater.log.
 * Also prints to console for dev convenience.
 * Log file is auto-rotated when exceeding 1MB.
 */
const UPDATER_LOG_MAX_SIZE = 1 * 1024 * 1024; // 1MB

function updaterLog(level, ...args) {
  const ts = new Date().toLocaleString('zh-CN', { hour12: false });
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  const line = `[${ts}] [${level}] ${msg}\n`;
  // Console output
  if (level === 'ERROR') console.error('[Updater]', ...args);
  else console.log('[Updater]', ...args);
  // File output
  try {
    fs.mkdirSync(UPDATES_DIR, { recursive: true });
    // Auto-rotate: if log exceeds max size, truncate to last half
    try {
      const stat = fs.statSync(UPDATER_LOG_PATH);
      if (stat.size > UPDATER_LOG_MAX_SIZE) {
        const content = fs.readFileSync(UPDATER_LOG_PATH, 'utf-8');
        const halfPoint = content.indexOf('\n', Math.floor(content.length / 2));
        fs.writeFileSync(UPDATER_LOG_PATH, content.slice(halfPoint + 1), 'utf-8');
      }
    } catch (_) { /* file may not exist yet */ }
    fs.appendFileSync(UPDATER_LOG_PATH, line, 'utf-8');
  } catch (_) { /* best effort */ }
}

/* ── Install event emitter (main.cjs listens for progress) ── */
const installEvents = new EventEmitter();

/* ── Install state (shared across calls for concurrency safety) ── */
let installState = {
  status: 'idle',      // idle | downloading | installing | done | error
  progress: 0,         // download percentage 0-100
  error: null,
  promise: null,       // current install promise (concurrency lock)
};

/* ── Shell environment resolution (macOS GUI apps lack full PATH) ── */

/**
 * Resolve the user's full login-shell environment.
 * On macOS, GUI apps launched from Finder don't execute .zshrc/.bashrc,
 * so PATH misses nvm, kd, and other user-installed tools.
 * This function runs the user's default shell in login-interactive mode
 * to capture the real environment, then caches it.
 */
function resolveShellEnv() {
  if (resolvedShellEnv) return Promise.resolve(resolvedShellEnv);

  // Only needed on macOS; on Windows/Linux the env is usually fine
  if (process.platform !== 'darwin') {
    resolvedShellEnv = { ...process.env };
    return Promise.resolve(resolvedShellEnv);
  }

  return new Promise((resolve) => {
    const userShell = process.env.SHELL || '/bin/zsh';
    // Use login (-l) + interactive (-i) mode to source all profile files,
    // then print PATH so we can merge it.
    const child = spawn(userShell, ['-ilc', 'echo __PATH_START__"$PATH"__PATH_END__'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
      env: { ...process.env },
    });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.on('close', () => {
      const match = stdout.match(/__PATH_START__(.+?)__PATH_END__/);
      if (match && match[1]) {
        const shellPath = match[1].trim();
        console.log('[Sidecar] Resolved shell PATH:', shellPath);
        resolvedShellEnv = { ...process.env, PATH: shellPath };
      } else {
        console.warn('[Sidecar] Could not resolve shell PATH, using process.env');
        resolvedShellEnv = { ...process.env };
      }
      resolve(resolvedShellEnv);
    });
    child.on('error', (err) => {
      console.warn('[Sidecar] Shell env resolution failed:', err.message);
      resolvedShellEnv = { ...process.env };
      resolve(resolvedShellEnv);
    });
  });
}

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
 * Download a file with progress reporting (no resume support).
 * Used for first-time install where no partial file exists.
 * Returns the local file path.
 */
function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 60000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
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
 * Download a file with resume (Range header) support.
 * If destPath already exists with partial content, resumes from that offset.
 * If the server does not support Range, restarts from scratch.
 * Returns the local file path.
 */
function downloadFileResumable(url, destPath, onProgress, expectedSize, _attempt) {
  if (!_attempt) _attempt = 0;
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    let existingSize = 0;
    try {
      const stat = fs.statSync(destPath);
      existingSize = stat.size;
    } catch (_) { /* file does not exist yet */ }

    // If we already have the full file, skip download
    if (expectedSize && existingSize >= expectedSize) {
      updaterLog('INFO', 'File already fully downloaded:', destPath, `(${existingSize} bytes)`);
      if (onProgress) onProgress(100);
      return resolve(destPath);
    }

    const isResuming = existingSize > 0;
    const headers = {};
    if (isResuming) {
      headers['Range'] = `bytes=${existingSize}-`;
      updaterLog('INFO', 'Resuming download from byte', existingSize);
    }

    // Helper: on failure, clean up and retry (up to 3 attempts total).
    // If resuming, delete partial file + download-meta to start fresh.
    // Only skip retry if server is completely unreachable.
    function retryOrFail(err) {
      const code = err.code || '';
      const unreachable = ['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code);
      if (unreachable) {
        updaterLog('ERROR', 'Server unreachable (' + code + '), will retry next cycle');
        reject(err);
        return;
      }
      if (_attempt >= 2) {
        updaterLog('ERROR', 'Download failed after 3 attempts (' + err.message + '), will retry next cycle');
        reject(err);
        return;
      }
      // Clean up partial file and download metadata before retry
      try { fs.unlinkSync(destPath); } catch (_) {}
      try { fs.unlinkSync(DOWNLOAD_META_PATH); } catch (_) {}
      updaterLog('WARN', 'Download failed (' + err.message + '), attempt ' + (_attempt + 1) + '/3, retrying full download');
      downloadFileResumable(url, destPath, onProgress, expectedSize, _attempt + 1).then(resolve, reject);
    }

    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 120000, headers }, (res) => {
      // Follow redirect
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return downloadFileResumable(res.headers.location, destPath, onProgress, expectedSize, _attempt).then(resolve, reject);
      }

      // 206 Partial Content = resume accepted
      // 200 OK = server doesn't support Range, restart from scratch
      if (res.statusCode === 200 && isResuming) {
        updaterLog('INFO', 'Server does not support Range, restarting download');
        existingSize = 0; // reset
      } else if (res.statusCode !== 200 && res.statusCode !== 206) {
        res.resume();
        return retryOrFail(new Error(`HTTP ${res.statusCode} downloading ${url}`));
      }

      const contentLength = parseInt(res.headers['content-length'], 10) || 0;
      const total = res.statusCode === 206 ? existingSize + contentLength : contentLength;
      let downloaded = existingSize;

      const fileFlags = res.statusCode === 206 ? 'a' : 'w'; // append or overwrite
      const file = fs.createWriteStream(destPath, { flags: fileFlags });
      res.on('data', (chunk) => {
        downloaded += chunk.length;
        if (total > 0 && onProgress) {
          onProgress(Math.round((downloaded / total) * 100));
        }
      });
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          updaterLog('INFO', 'Download complete:', destPath, `(${downloaded} bytes)`);
          resolve(destPath);
        });
      });
      file.on('error', (err) => {
        retryOrFail(err);
      });
    });
    req.on('error', (err) => {
      updaterLog('ERROR', 'Download network error:', err.message);
      retryOrFail(err);
    });
    req.on('timeout', () => {
      req.destroy();
      updaterLog('ERROR', 'Download timeout');
      retryOrFail(new Error('Download timeout'));
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

    // Download file and download dir are kept — CDN flow naturally overwrites them.

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
 * Simple check: is opencode binary present?
 * No CDN call, no version comparison, no deletion.
 * Returns { installed: boolean }
 */
function checkOpencodeInstalled() {
  const exists = isOpencodeInstalled();
  updaterLog('INFO', 'checkOpencodeInstalled:', exists);
  return { installed: exists };
}

/**
 * Background update check: fetch CDN latest.json, compare with local version,
 * if newer → download to ~/.kcode/updates/download/ with resume support → write update-pending.json.
 * Returns { hasUpdate, version, downloading } or { hasUpdate: false }.
 * This runs silently in the background on a timer from main.cjs.
 */
let _bgCheckRunning = false;
async function backgroundUpdateCheck() {
  // Guard: prevent concurrent execution
  if (_bgCheckRunning) {
    updaterLog('INFO', 'Background update check skipped: previous check still running');
    return { hasUpdate: false, reason: 'already_running' };
  }
  _bgCheckRunning = true;
  try {
    return await _doBackgroundUpdateCheck();
  } finally {
    _bgCheckRunning = false;
  }
}

async function _doBackgroundUpdateCheck() {
  updaterLog('INFO', '=== Background update check started ===');

  // 1. Must have opencode installed to compare versions
  if (!isOpencodeInstalled()) {
    updaterLog('INFO', 'opencode not installed, skipping background check');
    return { hasUpdate: false, reason: 'not_installed' };
  }

  // 2. Check if there's already a pending update ready to apply
  if (fs.existsSync(UPDATE_PENDING_PATH)) {
    try {
      const pending = JSON.parse(fs.readFileSync(UPDATE_PENDING_PATH, 'utf-8'));
      const currentVer = await getOpencodeVersion();
      if (pending.version && (!currentVer || compareVersions(pending.version, currentVer) > 0)) {
        // Verify the download file actually exists
        if (pending.binary && fs.existsSync(pending.binary)) {
          updaterLog('INFO', 'Pending update v' + pending.version + ' already ready, notifying');
          return { hasUpdate: true, version: pending.version, alreadyReady: true };
        } else {
          // Binary missing — don't cleanup, let CDN check below re-download
          updaterLog('INFO', 'Pending update v' + pending.version + ' exists but binary missing, will re-download via CDN check');
        }
      } else {
        // Stale pending — CDN check below will overwrite if newer version exists
        updaterLog('INFO', 'Pending update v' + pending.version + ' is stale (current: v' + currentVer + '), skipping');
      }
    } catch (err) {
      // Corrupt pending json — CDN check below will overwrite if newer version exists
      updaterLog('ERROR', 'Failed to read pending update:', err.message, ', skipping');
    }
  }

  // 3. Fetch CDN latest.json
  const platformKey = getPlatformKey();
  let latest;
  try {
    const latestUrl = `${CDN_BASE}/latest.json`;
    updaterLog('INFO', 'Fetching', latestUrl);
    latest = await fetchJson(latestUrl);
    updaterLog('INFO', 'CDN latest version:', latest.version);
  } catch (err) {
    updaterLog('ERROR', 'CDN unreachable:', err.message);
    return { hasUpdate: false, reason: 'cdn_error', error: err.message };
  }

  // 4. Compare with local version
  const localVersion = await getOpencodeVersion();
  const remoteVersion = latest.version;
  updaterLog('INFO', 'Version comparison: local=' + localVersion + ' remote=' + remoteVersion);

  if (!remoteVersion || (localVersion && compareVersions(remoteVersion, localVersion) <= 0)) {
    updaterLog('INFO', 'Already up to date');
    return { hasUpdate: false, localVersion, remoteVersion };
  }

  // 5. Match platform
  const fileInfo = latest.files && latest.files[platformKey];
  if (!fileInfo) {
    updaterLog('ERROR', 'Platform', platformKey, 'not found in latest.json');
    return { hasUpdate: false, reason: 'platform_unsupported' };
  }

  const assetName = fileInfo.name;
  const expectedSha256 = (fileInfo.sha256 || '').toLowerCase();
  const expectedSize = fileInfo.size || 0;
  const downloadUrl = `${CDN_BASE}/${assetName}`;
  const localPath = path.join(DOWNLOAD_DIR, assetName);

  updaterLog('INFO', 'New version available: v' + remoteVersion + ', downloading', assetName);

  // 6. Pre-check: if a partial file exists, verify it belongs to the same version.
  //    Compare against stored download metadata to detect version change.
  if (fs.existsSync(localPath)) {
    let shouldDelete = false;
    try {
      if (fs.existsSync(DOWNLOAD_META_PATH)) {
        const meta = JSON.parse(fs.readFileSync(DOWNLOAD_META_PATH, 'utf-8'));
        if (meta.version !== remoteVersion || meta.sha256 !== expectedSha256) {
          updaterLog('INFO', 'Partial file belongs to v' + meta.version + ' but now need v' + remoteVersion + ', deleting stale file');
          shouldDelete = true;
        }
      } else {
        // No metadata file — can't verify, safer to delete and re-download
        updaterLog('INFO', 'Partial file exists but no download metadata, deleting to be safe');
        shouldDelete = true;
      }
    } catch (err) {
      updaterLog('WARN', 'Failed to read download metadata:', err.message);
      shouldDelete = true;
    }
    if (shouldDelete) {
      try { fs.unlinkSync(localPath); } catch (_) {}
      try { fs.unlinkSync(DOWNLOAD_META_PATH); } catch (_) {}
    }
  }

  // Write download metadata so we can verify on resume after restart
  try {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    fs.writeFileSync(DOWNLOAD_META_PATH, JSON.stringify({
      version: remoteVersion,
      sha256: expectedSha256,
      expectedSize,
      assetName,
      startedAt: new Date().toISOString(),
    }), 'utf-8');
  } catch (err) {
    updaterLog('WARN', 'Failed to write download metadata:', err.message);
  }

  // 7. Download with resume support
  try {
    await downloadFileResumable(downloadUrl, localPath, (percent) => {
      // Silent background download, no UI events
      if (percent % 20 === 0) updaterLog('INFO', 'Background download progress:', percent + '%');
    }, expectedSize);
  } catch (err) {
    updaterLog('ERROR', 'Background download failed:', err.message, '(will retry next cycle)');
    return { hasUpdate: false, reason: 'download_failed', error: err.message };
  }

  // 7. SHA256 verify
  if (expectedSha256) {
    const computed = sha256File(localPath);
    if (computed !== expectedSha256) {
      updaterLog('ERROR', 'SHA256 mismatch! expected:', expectedSha256, 'got:', computed);
      try { fs.unlinkSync(localPath); } catch (_) {}
      try { fs.unlinkSync(DOWNLOAD_META_PATH); } catch (_) {}
      return { hasUpdate: false, reason: 'sha256_mismatch' };
    }
    updaterLog('INFO', 'SHA256 verification passed');
  }

  // 8. Write update-pending.json
  const pendingData = {
    version: remoteVersion,
    binary: localPath,
    sha256: expectedSha256,
    downloadedAt: new Date().toISOString(),
    platform: platformKey,
  };
  try {
    fs.mkdirSync(UPDATES_DIR, { recursive: true });
    fs.writeFileSync(UPDATE_PENDING_PATH, JSON.stringify(pendingData, null, 2), 'utf-8');
    updaterLog('INFO', 'Written update-pending.json for v' + remoteVersion);
    // Clean up download metadata — no longer needed
    try { fs.unlinkSync(DOWNLOAD_META_PATH); } catch (_) {}
  } catch (err) {
    updaterLog('ERROR', 'Failed to write update-pending.json:', err.message);
    return { hasUpdate: false, reason: 'write_failed', error: err.message };
  }

  updaterLog('INFO', '=== Background update check complete: v' + remoteVersion + ' ready ===');
  return { hasUpdate: true, version: remoteVersion };
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
    updaterLog('INFO', 'No pending update');
    return { applied: false };
  }

  // 2. Parse
  let pending;
  try {
    pending = JSON.parse(fs.readFileSync(UPDATE_PENDING_PATH, 'utf-8'));
  } catch (err) {
    updaterLog('ERROR', 'Bad update-pending.json:', err.message);
    return { applied: false, error: 'parse_error' };
  }

  const { version: pendingVer, binary, sha256, forced } = pending;
  updaterLog('INFO', 'Pending update v' + pendingVer, '| binary:', binary, '| forced:', forced);

  // 3. Compare with local version
  const currentVer = await getOpencodeVersion();
  if (currentVer && compareVersions(pendingVer, currentVer) <= 0) {
    updaterLog('INFO', 'Pending v' + pendingVer + ' <= local v' + currentVer + ', skipping');
    return { applied: false, reason: 'not_newer' };
  }
  updaterLog('INFO', 'Applying update: local v' + (currentVer || 'unknown') + ' → v' + pendingVer);

  // 4. Verify archive exists
  if (!binary || !fs.existsSync(binary)) {
    updaterLog('ERROR', 'Archive not found:', binary);
    return { applied: false, error: 'archive_missing' };
  }

  // 5. SHA256 verification
  if (sha256) {
    const computed = sha256File(binary);
    if (computed !== sha256.toLowerCase()) {
      updaterLog('ERROR', 'SHA256 mismatch! expected:', sha256, 'got:', computed);
      return { applied: false, error: 'sha256_mismatch' };
    }
    updaterLog('INFO', 'SHA256 verification passed');
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
      updaterLog('INFO', 'Backed up old binary to', backupPath);
    }
  } catch (err) {
    updaterLog('ERROR', 'Backup failed:', err.message);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-update-'));
  try {
    await extractArchive(binary, tmpDir);
    const extracted = findFile(tmpDir, exeName);
    if (!extracted) throw new Error('opencode binary not found in archive');

    fs.copyFileSync(extracted, destBin);
    if (process.platform !== 'win32') fs.chmodSync(destBin, 0o755);

    updaterLog('INFO', 'Successfully updated opencode to v' + pendingVer);
    try { fs.unlinkSync(backupPath); } catch (_) {}
    return { applied: true, version: pendingVer };
  } catch (err) {
    updaterLog('ERROR', 'Update extraction failed:', err.message);
    // Rollback
    try {
      if (fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, destBin);
        if (process.platform !== 'win32') fs.chmodSync(destBin, 0o755);
        updaterLog('INFO', 'Rolled back to previous binary');
      }
    } catch (rbErr) {
      updaterLog('ERROR', 'Rollback failed:', rbErr.message);
    }
    return { applied: false, error: 'extract_failed' };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// NOTE: update-pending.json is NEVER deleted — it can only be overwritten
// after a successful download + SHA256 verification in backgroundUpdateCheck().
// download directory is also NEVER deleted — CDN flow naturally overwrites files.

/**
 * Check if there's a pending update available (used internally by main.cjs).
 * Returns { hasUpdate: boolean, version?: string, currentVersion?: string }
 */
async function checkPendingUpdate() {
  if (!fs.existsSync(UPDATE_PENDING_PATH)) {
    return { hasUpdate: false };
  }
  let pending;
  try {
    pending = JSON.parse(fs.readFileSync(UPDATE_PENDING_PATH, 'utf-8'));
  } catch (err) {
    updaterLog('ERROR', 'Bad update-pending.json:', err.message);
    return { hasUpdate: false, error: 'parse_error' };
  }
  const { version: pendingVer } = pending;
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

    // Resolve full login-shell environment (includes nvm, kd, etc.)
    const shellEnv = await resolveShellEnv();
    const env = {
      ...shellEnv,
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
  checkOpencodeInstalled,
  backgroundUpdateCheck,
  getOpencodeVersion,
  applyPendingUpdate,
  checkPendingUpdate,
  getAppBinDir,
  installOpencode,
  getInstallState,
  installEvents,
  resolveShellEnv,
};
