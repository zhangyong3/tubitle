import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, openSync, closeSync, linkSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import { defaultModel, models } from '../models/index.mjs';

const entry = fileURLToPath(import.meta.url);
const apiEntry = fileURLToPath(new URL('../http/server.mjs', import.meta.url));
process.chdir(fileURLToPath(new URL('../../', import.meta.url)));
const modelNames = [...models.keys()].join('|');
const port = Number(process.env.TUBITLE_PORT ?? 18081);
const backendPort = Number(process.env.TUBITLE_BACKEND_PORT ?? 18080);
if ([port, backendPort].some(value => !Number.isInteger(value) || value < 1024 || value > 65535) || port === backendPort) {
  throw new Error('TUBITLE_PORT 和 TUBITLE_BACKEND_PORT 必须是不同的有效端口');
}
const base = `http://127.0.0.1:${port}`;
const directory = `.runtime/service-${port}`;
const stateFile = `${directory}/state.json`;
const logFile = `${directory}/service.log`;

function selectModel(name) {
  const model = models.get(name);
  if (!model) throw new Error(`请选择模型：${[...models.keys()].join('、')}`);
  return model;
}

function setup(name) {
  const result = spawnSync('bash', [selectModel(name).setupScript], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

function readState() {
  try { return JSON.parse(readFileSync(stateFile, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function isRunning(state) {
  if (!Number.isSafeInteger(state?.pid) || state.pid < 2 || !/^[a-f0-9-]{36}$/.test(state.token ?? '')) return false;
  const result = spawnSync('ps', ['-ww', '-p', String(state.pid), '-o', 'command='], { encoding: 'utf8' });
  return result.status === 0 && result.stdout.trimEnd().endsWith(` _run ${state.name} ${state.token}`);
}

function removeState(token) {
  if (readState()?.token !== token) return;
  try { unlinkSync(stateFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

async function health() {
  try {
    const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2500) });
    return response.ok ? await response.json() : null;
  } catch { return null; }
}

async function checkPort(value) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error(`端口 ${value} 已被占用。请先停止该端口上的旧服务，或设置其他端口。`)));
    probe.listen(value, '127.0.0.1', () => probe.close(resolve));
  });
}

async function start(name) {
  const model = selectModel(name);
  model.backendCommand(backendPort);
  const old = readState();
  if (isRunning(old)) throw new Error(`服务已运行（${old.name}）；切换请用 restart ${name}`);
  if (old) removeState(old.token);
  await checkPort(port);
  await checkPort(backendPort);
  mkdirSync(directory, { recursive: true });
  const token = randomUUID();
  const log = openSync(logFile, 'a');
  const child = spawn(process.execPath, [entry, '_run', name, token], {
    detached: true, stdio: ['ignore', log, log],
  });
  closeSync(log);
  child.unref();
  let failure;
  child.on('error', error => { failure = error; });
  console.log(`正在启动 ${name}…`);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && child.exitCode === null && child.signalCode === null && !failure) {
    if (readState()?.token === token && (await health())?.model === model.id) {
      console.log(`${name} 已就绪：${base}`);
      return;
    }
    await delay(250);
  }
  if (isRunning({ pid: child.pid, name, token })) child.kill();
  throw new Error(`服务未就绪；查看 ${logFile}${failure ? `：${failure.message}` : ''}`);
}

async function stop() {
  const state = readState();
  if (!isRunning(state)) {
    if (state) removeState(state.token);
    console.log('没有运行中的 Tubitle 服务。');
    return;
  }
  try { process.kill(state.pid, 'SIGTERM'); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
  for (let i = 0; i < 40; i++) {
    if (!isRunning(state)) {
      console.log(`${state.name} 已停止。`);
      return;
    }
    await delay(250);
  }
  throw new Error(`服务未能停止；查看 ${logFile}`);
}

async function run(name, token) {
  const model = selectModel(name);
  const backend = model.backendCommand(backendPort);
  const pendingState = `${directory}/${token}.json`;
  writeFileSync(pendingState, JSON.stringify({ name, token, pid: process.pid }), { flag: 'wx' });
  try { linkSync(pendingState, stateFile); } finally { unlinkSync(pendingState); }
  const children = [];
  let stopping = false;
  let exitCode = 0;
  function shutdown(code) {
    if (stopping) return;
    stopping = true;
    exitCode = code;
    for (const child of children) child.kill('SIGTERM');
    const timer = setTimeout(() => { for (const child of children) child.kill('SIGKILL'); }, 4000);
    timer.unref();
  }
  process.on('SIGTERM', () => shutdown(0));
  process.on('SIGINT', () => shutdown(0));
  try {
    console.log(`\n${new Date().toISOString()} ${name}, API ${port}, backend ${backendPort}`);
    const launch = (command, args, env) => {
      const child = spawn(command, args, { env, stdio: ['ignore', 'inherit', 'inherit'] });
      children.push(child);
      child.on('error', error => { console.error(error.message); shutdown(1); });
      return new Promise(resolve => child.once('close', (code, signal) => {
        if (!stopping) {
          console.error(`${command} exited (${code ?? signal})`);
          shutdown(1);
        }
        resolve();
      }));
    };
    await Promise.all([
      launch(backend.command, backend.args, backend.env),
      launch(process.execPath, [apiEntry], {
        ...process.env, PORT: String(port), TRANSLATION_MODEL: model.id,
        TRANSLATION_BACKEND_PORT: String(backendPort),
      }),
    ]);
    process.exitCode = exitCode;
  } finally {
    removeState(token);
  }
}

const [action, argument, token] = process.argv.slice(2);
try {
  switch (action) {
    case 'setup': setup(argument ?? defaultModel); break;
    case 'start': await start(argument ?? defaultModel); break;
    case 'stop': await stop(); break;
    case 'restart': {
      const name = argument ?? readState()?.name ?? defaultModel;
      selectModel(name).backendCommand(backendPort);
      await stop();
      await start(name);
      break;
    }
    case 'status': {
      const state = readState();
      const info = await health();
      if (isRunning(state)) {
        const ready = info !== null && info.model === models.get(state.name)?.id;
        console.log(`${state.name} ${ready ? '已就绪' : '未就绪'}：${base}`);
        if (!ready) process.exitCode = 1;
      } else {
        console.log(`${base} ${info ? '由其他进程提供服务' : '未运行'}`);
        process.exitCode = 1;
      }
      break;
    }
    case 'logs': console.log(readFileSync(logFile, 'utf8').trimEnd().split('\n').slice(-40).join('\n')); break;
    case '_run': await run(argument, token); break;
    default:
      console.log(`用法：bash service.sh setup [${modelNames}] | start [${modelNames}] | restart [${modelNames}] | stop | status | logs`);
      if (action && !['help', '--help', '-h'].includes(action)) process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
