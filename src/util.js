'use strict';
const { execFile } = require('node:child_process');

const isWin = process.platform === 'win32';

/** Run a program with an args array (never a shell string). Always resolves. */
function run(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    execFile(
      cmd,
      args,
      {
        windowsHide: true,
        timeout: opts.timeout ?? 20000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, ...(opts.env || {}) },
        encoding: 'utf8',
      },
      (err, stdout, stderr) => {
        resolve({
          code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
          stdout: stdout || '',
          stderr: stderr || '',
          timedOut: !!(err && err.killed),
          ms: Date.now() - started,
        });
      }
    );
  });
}

/** Run a PowerShell script via -EncodedCommand (no quoting problems). */
function ps(script, opts = {}) {
  const wrapped =
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'; " + script;
  const enc = Buffer.from(wrapped, 'utf16le').toString('base64');
  return run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc],
    opts
  );
}

function withTimeout(promise, ms, label = 'timeout') {
  let t;
  return Promise.race([
    promise,
    new Promise((_, rej) => {
      t = setTimeout(() => rej(new Error(label)), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function isAdmin() {
  if (!isWin) return false;
  const r = await run('net', ['session'], { timeout: 5000 });
  return r.code === 0;
}

module.exports = { run, ps, isWin, withTimeout, sleep, isAdmin };
