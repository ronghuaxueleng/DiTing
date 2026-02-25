#!/usr/bin/env node
/**
 * DiTing 启动器
 * 使用 .venv 虚拟环境 + 本地 GPU (cuda:0)
 *
 * 用法: node start.mjs
 */

import { spawn, spawnSync } from 'child_process';
import { createInterface } from 'readline';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { totalmem, freemem } from 'os';

const ROOT = dirname(fileURLToPath(import.meta.url));
const IS_WIN = process.platform === 'win32';

// ── 颜色工具 ──────────────────────────────────────────────────────────────────
const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  red:    '\x1b[31m',
  gray:   '\x1b[90m',
};
const green  = s => `${c.green}${s}${c.reset}`;
const yellow = s => `${c.yellow}${s}${c.reset}`;
const cyan   = s => `${c.cyan}${s}${c.reset}`;
const red    = s => `${c.red}${s}${c.reset}`;
const gray   = s => `${c.gray}${s}${c.reset}`;
const bold   = s => `${c.bold}${s}${c.reset}`;

// ── Python 路径解析 ────────────────────────────────────────────────────────────
function findPython() {
  const candidates = IS_WIN
    ? ['.venv\\Scripts\\python.exe', '.venv\\Scripts\\python3.exe']
    : ['.venv/bin/python', '.venv/bin/python3'];

  for (const rel of candidates) {
    const full = join(ROOT, rel);
    if (existsSync(full)) return full;
  }
  return null;
}

// ── 进程管理 ───────────────────────────────────────────────────────────────────
const procs = new Map();

function launch(label, python, args, extraEnv = {}) {
  if (procs.has(label)) {
    console.log(yellow(`⚠  ${label} 已在运行，跳过`));
    return;
  }

  const env = { ...process.env, PYTHONIOENCODING: 'utf-8', ...extraEnv };
  const p = spawn(python, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });

  procs.set(label, p);

  const prefix = cyan(`[${label}]`);
  p.stdout.on('data', d => process.stdout.write(`${prefix} ${d}`));
  p.stderr.on('data', d => process.stderr.write(`${prefix} ${d}`));
  p.on('close', code => {
    procs.delete(label);
    console.log(`${prefix} ${gray(`进程退出（退出码 ${code}）`)}`);
  });

  console.log(green(`✓`) + ` ${label} 已启动 ${gray(`(PID ${p.pid})`)}`);
}

function stopAll() {
  if (procs.size === 0) return;
  console.log('\n正在停止所有服务...');
  for (const [label, p] of procs) {
    console.log(`  停止 ${label}...`);
    try { p.kill(IS_WIN ? 'SIGKILL' : 'SIGTERM'); } catch (_) {}
  }
  procs.clear();
}

// ── 启动函数 ───────────────────────────────────────────────────────────────────
function startServer(python) {
  launch('主服务', python, ['app/server.py']);
}

function startWorker(python, engine, port) {
  launch(
    `Worker-${engine}`,
    python,
    ['scripts/run_worker.py', '--engine', engine, '--port', String(port), '--device', 'cuda:0'],
  );
}

// ── 引擎配置 ───────────────────────────────────────────────────────────────────
const ENGINES = [
  { key: '1', name: 'sensevoice', port: 8001, label: 'SenseVoice', desc: '推荐，速度快，中文优秀，显存 ~2 GB' },
  { key: '2', name: 'whisper',    port: 8002, label: 'Whisper',    desc: '多语言，精度高，显存 ~6 GB' },
  { key: '3', name: 'qwen3asr',  port: 8003, label: 'Qwen3-ASR', desc: '逐字级时间戳，显存 ~8 GB' },
];

// ── 菜单渲染 ───────────────────────────────────────────────────────────────────
function printMainMenu() {
  console.log('');
  console.log(bold('╔══════════════════════════════════════════════╗'));
  console.log(bold('║       谛听 DiTing  启动器（本地 GPU）        ║'));
  console.log(bold('╚══════════════════════════════════════════════╝'));
  console.log('');
  console.log('请选择启动模式：\n');
  for (const e of ENGINES) {
    console.log(`  ${yellow(e.key)}. 主服务 + ${bold(e.label)}  ${gray(e.desc)}`);
  }
  console.log(`  ${yellow('4')}. 仅启动主服务`);
  console.log(`  ${yellow('5')}. 仅启动 ASR Worker`);
  console.log(`  ${yellow('0')}. 退出`);
  console.log('');
  process.stdout.write('请输入选项: ');
}

function printEngineMenu() {
  console.log('\n选择 ASR 引擎：\n');
  for (const e of ENGINES) {
    console.log(`  ${yellow(e.key)}. ${bold(e.label)}  ${gray(e.desc)}`);
  }
  console.log(`  ${yellow('0')}. 返回上级菜单`);
  console.log('');
  process.stdout.write('请输入: ');
}

function printRunning() {
  console.log('');
  console.log(green('🌐 访问地址: ') + bold('http://localhost:5023/app'));
  console.log(gray('按 Ctrl+C 停止所有服务'));
  console.log('');
}

// ── 本机配置检测 ───────────────────────────────────────────────────────────────
function execQuiet(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf-8', shell: IS_WIN, timeout: 5000 });
    return r.status === 0 ? r.stdout.trim() : null;
  } catch {
    return null;
  }
}

function printSysInfo(python) {
  console.log(bold('── 本机环境 ──────────────────────────────────────'));

  // Python 版本
  const pyVer = execQuiet(python, ['--version']);
  console.log(`  Python   ${pyVer ? green(pyVer.replace('Python ', '')) : gray('未知')}`);

  // 内存
  const totalGb = (totalmem() / 1024 ** 3).toFixed(1);
  const freeGb  = (freemem()  / 1024 ** 3).toFixed(1);
  console.log(`  内存     ${green(freeGb + ' GB')} 可用 / ${totalGb} GB 总计`);

  // GPU（nvidia-smi）
  const gpuRaw = execQuiet('nvidia-smi', [
    '--query-gpu=index,name,memory.total,memory.free,driver_version',
    '--format=csv,noheader,nounits',
  ]);

  if (gpuRaw) {
    for (const line of gpuRaw.split('\n').filter(Boolean)) {
      const [idx, name, total, free, driver] = line.split(',').map(s => s.trim());
      const freeGb  = (Number(free)  / 1024).toFixed(1);
      const totalGb = (Number(total) / 1024).toFixed(1);
      console.log(`  GPU ${idx}    ${green(name)}`);
      console.log(`           显存 ${green(freeGb + ' GB')} 可用 / ${totalGb} GB 总计  驱动 ${driver}`);
    }
  } else {
    console.log(`  GPU      ${gray('未检测到（nvidia-smi 不可用）')}`);
  }

  console.log(bold('──────────────────────────────────────────────────\n'));
}

// ── 安装模式选择 ───────────────────────────────────────────────────────────────
const INSTALL_MODES = [
  {
    key: '1',
    label: '全量安装',
    desc:  '主服务 + 全部 ASR 引擎（SenseVoice / Whisper / Qwen3-ASR）',
    args:  ['--extra', 'all'],
  },
  {
    key: '2',
    label: '主服务 + SenseVoice',
    desc:  '推荐，速度快，中文优秀，显存 ~2 GB',
    args:  ['--extra', 'worker', '--extra', 'sensevoice'],
  },
  {
    key: '3',
    label: '主服务 + Whisper',
    desc:  '多语言，精度高，显存 ~6 GB',
    args:  ['--extra', 'worker', '--extra', 'whisper'],
  },
  {
    key: '4',
    label: '主服务 + Qwen3-ASR',
    desc:  '逐字级时间戳，显存 ~8 GB',
    args:  ['--extra', 'worker', '--extra', 'qwen'],
  },
  {
    key: '5',
    label: '纯 Web 服务',
    desc:  '不安装 ASR 引擎，ASR 由远程 Worker 或云端提供',
    args:  [],
  },
];

function askInstallMode() {
  return new Promise((resolve) => {
    console.log(yellow('⚙  未找到 .venv，首次运行需要安装依赖'));
    console.log(bold('\n请选择安装模式：\n'));
    for (const m of INSTALL_MODES) {
      console.log(`  ${yellow(m.key)}. ${bold(m.label)}  ${gray(m.desc)}`);
    }
    console.log('');
    process.stdout.write('请输入选项: ');

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.on('line', (raw) => {
      const mode = INSTALL_MODES.find(m => m.key === raw.trim());
      if (mode) {
        rl.close();
        resolve(mode);
      } else {
        console.log(red('❌ 无效选项'));
        process.stdout.write('请输入选项: ');
      }
    });
  });
}

function runUvSync(extraArgs) {
  const cmd = ['sync', ...extraArgs];
  console.log(gray(`\n执行: uv ${cmd.join(' ')}`));
  console.log(gray('（可能需要几分钟，请耐心等待）\n'));

  return new Promise((resolve, reject) => {
    const p = spawn('uv', cmd, {
      cwd: ROOT,
      stdio: 'inherit',
      shell: IS_WIN,
      env: { ...process.env, UV_LINK_MODE: 'copy' },
    });
    p.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`uv sync 失败（退出码 ${code}）`));
    });
    p.on('error', err => {
      reject(new Error(`无法执行 uv，请确认已安装 uv：${err.message}`));
    });
  });
}

// ── 前端构建 ───────────────────────────────────────────────────────────────────
function buildFrontend() {
  const distDir = join(ROOT, 'frontend', 'dist');
  if (existsSync(distDir)) return Promise.resolve();

  console.log(yellow('⚙  未找到 frontend/dist，正在构建前端...'));

  return new Promise((resolve, reject) => {
    const opts = { cwd: join(ROOT, 'frontend'), stdio: 'inherit', shell: IS_WIN };

    console.log(gray('执行: npm install\n'));
    const install = spawn('npm', ['install'], opts);
    install.on('error', err => reject(new Error(`npm install 失败：${err.message}`)));
    install.on('close', code => {
      if (code !== 0) return reject(new Error(`npm install 失败（退出码 ${code}）`));

      console.log(gray('\n执行: npm run build\n'));
      const build = spawn('npm', ['run', 'build'], opts);
      build.on('error', err => reject(new Error(`npm run build 失败：${err.message}`)));
      build.on('close', code => {
        if (code !== 0) return reject(new Error(`npm run build 失败（退出码 ${code}）`));
        console.log(green('✓') + ' 前端构建完成\n');
        resolve();
      });
    });
  });
}

// ── 主流程 ─────────────────────────────────────────────────────────────────────
async function main() {
  let python = findPython();
  if (!python) {
    const mode = await askInstallMode();
    await runUvSync(mode.args);
    python = findPython();
    if (!python) {
      console.error(red('❌ uv sync 完成但仍未找到 .venv，请检查环境'));
      process.exit(1);
    }
    console.log('');
  }
  console.log(green('✓') + ` Python: ${gray(python)}`);
  await buildFrontend();
  printSysInfo(python);

  process.on('SIGINT', () => {
    stopAll();
    setTimeout(() => process.exit(0), 1500);
  });

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let state = 'main';

  printMainMenu();

  rl.on('line', (raw) => {
    const ch = raw.trim();

    if (state === 'main') {
      const engine = ENGINES.find(e => e.key === ch);
      if (engine) {
        startServer(python);
        startWorker(python, engine.name, engine.port);
        printRunning();
        rl.close();
      } else if (ch === '4') {
        startServer(python);
        printRunning();
        rl.close();
      } else if (ch === '5') {
        state = 'worker_only';
        printEngineMenu();
      } else if (ch === '0') {
        rl.close();
        process.exit(0);
      } else {
        console.log(red('❌ 无效选项'));
        process.stdout.write('请输入选项: ');
      }
    } else if (state === 'worker_only') {
      const engine = ENGINES.find(e => e.key === ch);
      if (engine) {
        startWorker(python, engine.name, engine.port);
        printRunning();
        rl.close();
      } else if (ch === '0') {
        state = 'main';
        printMainMenu();
      } else {
        console.log(red('❌ 无效选项'));
        process.stdout.write('请输入: ');
      }
    }
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
