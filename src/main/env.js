// The app's settings: the API key, the model, and a few preferences.
//
// They can come from three places, strongest first: the real environment, a .env file
// (when running from source), and the settings file in the app's data folder (the route
// for people using the packaged app).
//
// Values are held in this module, not in process.env. Chromium starts its helper
// processes with a copy of the environment, so a key left there would be handed to every
// page's process. captureEnvironment() therefore moves the settings out of the
// environment before any window exists.
const fs = require('node:fs');
const path = require('node:path');

const SETTINGS_KEYS = ['NEBIUS_API_KEY', 'NEBIUS_MODEL', 'NEBIUS_BASE_URL', 'NEBIUS_REASONING_EFFORT', 'NEBIUS_MAX_TOKENS', 'START_URL', 'COMPANION_MASCOT', 'COMPANION_NAME'];
const values = new Map(); // key -> { value, source: 'env' | 'dotenv' | 'file' | 'saved' }

const get = (key) => values.get(key)?.value || '';

function parse(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// Takes the settings out of the real environment and keeps them here instead.
function captureEnvironment() {
  for (const key of SETTINGS_KEYS) {
    const value = process.env[key];
    if (value) values.set(key, { value, source: 'env' });
    delete process.env[key];
  }
}

// Reads .env files from startDir upwards (source checkouts only). Only the settings
// above are taken; anything else in those files is ignored.
function loadEnv(startDir, maxDepth = 4) {
  let dir = startDir;
  for (let i = 0; i < maxDepth; i += 1) {
    const file = path.join(dir, '.env');
    if (fs.existsSync(file)) {
      const pairs = parse(fs.readFileSync(file, 'utf8'));
      for (const key of SETTINGS_KEYS) {
        if (pairs[key] && !values.has(key)) values.set(key, { value: pairs[key], source: 'dotenv' });
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

// Reads the settings file. Environment and .env values win; values that came from this
// file are refreshed on every call, so edits take effect without restarting.
function loadSettingsFile(file) {
  for (const [key, entry] of values) if (entry.source === 'file') values.delete(key);
  let pairs = {};
  try {
    pairs = parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
  for (const key of SETTINGS_KEYS) {
    if (pairs[key] && !values.has(key)) values.set(key, { value: pairs[key], source: 'file' });
  }
  return true;
}

const SETTINGS_TEMPLATE = `# Reading Companion settings
#
# Paste your Nebius Token Factory API key after the = sign on the next line and
# save this file. The app notices on its own.
# Create a key at https://tokenfactory.nebius.com
NEBIUS_API_KEY=

# Optional: the model that writes the explanations. Leave empty for the default.
NEBIUS_MODEL=

# Optional: a page to open when the app starts.
START_URL=

# Optional: companion design (quippy, snippy or tippy) and a name of your own for it.
COMPANION_MASCOT=
COMPANION_NAME=
`;

function ensureSettingsFile(file) {
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, SETTINGS_TEMPLATE, { mode: 0o600 });
  }
  return file;
}

// Writes one value into the settings file (replacing its line, or adding one) and applies
// it to this session straight away, even over a value that came from the environment.
function saveSetting(file, key, value) {
  if (!SETTINGS_KEYS.includes(key) || /[\r\n]/.test(String(value))) throw new Error('Not a setting that can be saved');
  ensureSettingsFile(file);
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const at = lines.findIndex((line) => line.trim().replace(/^export\s+/, '').startsWith(`${key}=`));
  if (at >= 0) lines[at] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  fs.writeFileSync(file, lines.join('\n'), { mode: 0o600 });
  fs.chmodSync(file, 0o600); // an existing file keeps its old mode otherwise
  values.set(key, { value: String(value), source: 'saved' });
}

module.exports = { get, captureEnvironment, loadEnv, loadSettingsFile, ensureSettingsFile, saveSetting };
