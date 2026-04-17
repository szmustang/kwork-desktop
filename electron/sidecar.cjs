const { spawn, execFile } = require('child_process');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const os = require('os');

let sidecarProcess = null;
let cachedServerInfo = null;
const childPids = new Set(); // track all spawned child PIDs for cleanup

const KCODE_DIR = path.join(process.env.HOME || os.homedir(), '.kcode');
const SERVER_JSON_PATH = path.join(KCODE_DIR, 'server.json');

/* ── Paths ── */

function getAppBinDir() {
  // In production: resources/bin/  In dev: electron/bin/
  const isDev = !!process.env.VITE_DEV_SERVER_URL;
  if (isDev) {
    return path.join(__dirname, 'bin');
  }
  return path.join(process.resourcesPath, 'bin');
}

function getAppDataDir() {
  // Data dir alongside bin dir: electron/data/ or resources/data/
  const binDir = getAppBinDir();
  const dataDir = path.join(path.dirname(binDir), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

function getOpencodeBinPath() {
  const binDir = getAppBinDir();
  const exe = process.platform === 'win32' ? 'opencode.exe' : 'opencode';
  return path.join(binDir, exe);
}

/* ── Check if opencode is installed ── */

function isOpencodeInstalled() {
  const binPath = getOpencodeBinPath();
  return fs.existsSync(binPath);
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

/* ── Download & Install ── */

const CDN_BASE_URL = 'http://tdmrxr8op.hn-bkt.clouddn.com';
const BUILD_VERSION_URL = `${CDN_BASE_URL}/buildVersion.json`;

/**
 * Fetch buildVersion.json from CDN.
 * Returns { version, fileName } or null on failure.
 */
function fetchBuildVersion() {
  return new Promise((resolve) => {
    const httpModule = BUILD_VERSION_URL.startsWith('https') ? https : http;
    httpModule.get(BUILD_VERSION_URL, { headers: { 'User-Agent': 'kwork-desktop' }, timeout: 10000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return resolve(null);
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (_) {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null))
      .on('timeout', function() { this.destroy(); resolve(null); });
  });
}

/**
 * Get download URL from CDN based on buildVersion.json.
 * Returns { url, fileName } or throws on failure.
 */
async function getDownloadInfo() {
  const buildVersion = await fetchBuildVersion();
  if (!buildVersion || !buildVersion.fileName) {
    throw new Error('Failed to fetch buildVersion.json from CDN');
  }
  return {
    url: `${CDN_BASE_URL}/${buildVersion.fileName}`,
    fileName: buildVersion.fileName,
  };
}

function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const follow = (u) => {
      const httpModule = u.startsWith('https') ? https : http;
      httpModule.get(u, { headers: { 'User-Agent': 'kwork-desktop' } }, (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return follow(res.headers.location);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        }
        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let downloaded = 0;
        const fileStream = fs.createWriteStream(destPath);
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (onProgress && totalBytes > 0) {
            onProgress({ downloaded, totalBytes, percent: Math.round((downloaded / totalBytes) * 100) });
          }
        });
        res.pipe(fileStream);
        fileStream.on('finish', () => { fileStream.close(); resolve(); });
        fileStream.on('error', reject);
      }).on('error', reject);
    };
    follow(url);
  });
}

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

async function installOpencode(onProgress) {
  const binDir = getAppBinDir();
  fs.mkdirSync(binDir, { recursive: true });

  const downloadInfo = await getDownloadInfo();
  const url = downloadInfo.url;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-'));
  const archiveName = downloadInfo.fileName;
  const zipPath = path.join(tmpDir, archiveName);

  try {
    // Step 1: Download
    if (onProgress) onProgress({ stage: 'downloading', percent: 0 });
    await downloadFile(url, zipPath, (p) => {
      if (onProgress) onProgress({ stage: 'downloading', ...p });
    });

    // Step 2: Unzip
    if (onProgress) onProgress({ stage: 'extracting', percent: 0 });
    await extractArchive(zipPath, tmpDir);

    // Step 3: Find the opencode binary in extracted files and copy to binDir
    if (onProgress) onProgress({ stage: 'installing', percent: 50 });
    const exeName = process.platform === 'win32' ? 'opencode.exe' : 'opencode';
    const extracted = findFile(tmpDir, exeName);
    if (!extracted) {
      throw new Error('opencode binary not found in archive');
    }
    const destBin = path.join(binDir, exeName);
    fs.copyFileSync(extracted, destBin);

    // Step 4: Make executable (unix)
    if (process.platform !== 'win32') {
      fs.chmodSync(destBin, 0o755);
    }

    if (onProgress) onProgress({ stage: 'done', percent: 100 });
    return true;
  } finally {
    // Cleanup temp
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
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

/* ── Update Check ── */

/**
 * Fetch latest version from CDN buildVersion.json.
 * Returns version string (e.g. "0.0.6") or null on failure.
 */
async function fetchLatestVersion() {
  const buildVersion = await fetchBuildVersion();
  if (!buildVersion || !buildVersion.version) {
    return null;
  }
  return buildVersion.version;
}

/**
 * Normalize version string for comparison.
 * Strips leading 'v' and returns comparable string.
 */
function normalizeVersion(v) {
  if (!v) return '';
  return v.replace(/^v/i, '').trim();
}

/**
 * Check if a newer version is available.
 * Returns { hasUpdate, currentVersion, latestVersion } 
 */
async function checkForUpdate() {
  const currentRaw = await getOpencodeVersion();
  const latestRaw = await fetchLatestVersion();
  
  console.log('[Sidecar] Version check: current =', currentRaw, ', latest =', latestRaw);
  
  if (!currentRaw || !latestRaw) {
    return { hasUpdate: false, currentVersion: currentRaw, latestVersion: latestRaw };
  }
  
  const current = normalizeVersion(currentRaw);
  const latest = normalizeVersion(latestRaw);
  
  // Simple string comparison — works for semver if format is consistent
  const hasUpdate = latest !== current && latest > current;
  return { hasUpdate, currentVersion: currentRaw, latestVersion: latestRaw };
}

/**
 * Update opencode binary to latest version.
 * Kills running sidecar first, then downloads and replaces.
 */
async function updateOpencode(onProgress) {
  // Kill running sidecar before replacing binary
  killSidecar();
  
  // Also kill any externally running process from server.json
  const serverJson = readServerJson();
  if (serverJson && serverJson.pid) {
    try {
      process.kill(serverJson.pid, 'SIGTERM');
      console.log('[Sidecar] Killed running server pid', serverJson.pid, 'for update');
    } catch (_) { /* already dead */ }
  }
  cachedServerInfo = null;
  
  // Wait a moment for process to exit
  await new Promise(r => setTimeout(r, 500));
  
  // Reuse installOpencode to download and replace
  return installOpencode(onProgress);
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
  installOpencode,
  checkForUpdate,
  updateOpencode,
  getAppBinDir,
};
