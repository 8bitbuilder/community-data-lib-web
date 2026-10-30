/// <reference lib="webworker" />
// Pyodide web worker: loads Python + pandas, runs notebook cells.
import helpersSource from './helpers.py?raw';
import type { CellOutput } from './notebookStore';
import { safeFileName } from './pyodideProtocol';

const PYODIDE_BASE = 'https://cdn.jsdelivr.net/pyodide/v0.27.2/full/';

interface PyProxyLike {
  toJs(options?: { dict_converter?: (entries: Iterable<[string, unknown]>) => unknown }): unknown;
  destroy(): void;
}
type PyCallable = ((...args: unknown[]) => unknown) & { destroy?: () => void };
interface PyodideLike {
  loadPackage(names: string[]): Promise<void>;
  pyimport(name: string): { install: (pkg: string) => Promise<void> } & Record<string, PyCallable>;
  runPython(code: string): unknown;
  runPythonAsync(code: string): Promise<unknown>;
  FS: { writeFile(path: string, data: Uint8Array | string): void; mkdirTree(path: string): void };
  globals: { get(name: string): unknown };
  toPy(value: unknown): unknown;
}

type InMessage =
  | { type: 'init' }
  | { type: 'writeFile'; id: number; name: string; bytes: Uint8Array }
  | { type: 'run'; id: number; code: string }
  | { type: 'export'; id: number; format: 'csv' | 'xlsx' };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let pyodide: PyodideLike | null = null;
let helpers: Record<string, PyCallable> | null = null;
let ns: unknown = null;
let queue: Promise<void> = Promise.resolve();
let initStarted = false;

function toJs(value: unknown): unknown {
  if (value && typeof (value as PyProxyLike).toJs === 'function') {
    const proxy = value as PyProxyLike;
    const js = proxy.toJs({ dict_converter: Object.fromEntries });
    proxy.destroy();
    return js;
  }
  return value;
}

function status(text: string) {
  ctx.postMessage({ type: 'status', text });
}

async function init() {
  try {
    status('Loading Python…');
    const mod: { loadPyodide(o: { indexURL: string }): Promise<PyodideLike> } = await import(
      /* @vite-ignore */ `${PYODIDE_BASE}pyodide.mjs`
    );
    const py = await mod.loadPyodide({ indexURL: PYODIDE_BASE });
    status('Loading pandas…');
    await py.loadPackage(['pandas', 'micropip']);
    const micropip = py.pyimport('micropip');
    await micropip.install('openpyxl');
    py.FS.mkdirTree('/home/pyodide');
    py.FS.writeFile('/home/pyodide/cdl_helpers.py', helpersSource);
    py.runPython("import sys\nif '/home/pyodide' not in sys.path: sys.path.insert(0, '/home/pyodide')");
    helpers = py.pyimport('cdl_helpers') as unknown as Record<string, PyCallable>;
    ns = py.runPython('{}');
    pyodide = py;
    ctx.postMessage({ type: 'ready' });
  } catch (e) {
    ctx.postMessage({ type: 'fatal', message: e instanceof Error ? e.message : String(e) });
  }
}

function errorOutput(e: unknown): CellOutput {
  const message = e instanceof Error ? e.message : String(e);
  return { stdout: '', error: { name: e instanceof Error ? e.name : 'Error', message, traceback: message } };
}

async function handle(msg: InMessage) {
  if (msg.type === 'init') {
    if (initStarted) return;
    initStarted = true;
    return init();
  }
  if (!pyodide || !helpers) {
    ctx.postMessage({ type: 'error', id: msg.id, message: 'Python is not ready' });
    return;
  }
  const py = pyodide;
  const h = helpers;
  try {
    if (msg.type === 'writeFile') {
      const name = safeFileName(msg.name);
      if (!name) throw new Error(`Invalid file name: ${msg.name}`);
      if (name.endsWith('.xls')) await py.pyimport('micropip').install('xlrd');
      py.FS.writeFile(`/home/pyodide/${name}`, msg.bytes);
      ctx.postMessage({ type: 'done', id: msg.id });
    } else if (msg.type === 'run') {
      const output = toJs(h.run_cell(msg.code, ns)) as CellOutput;
      const dfInfo = toJs(h.df_info(ns)) ?? null;
      ctx.postMessage({ type: 'result', id: msg.id, output, dfInfo });
    } else if (msg.type === 'export') {
      const proxy = h.export_df(ns, msg.format) as PyProxyLike;
      const bytes = proxy.toJs() as Uint8Array;
      const copy = new Uint8Array(bytes);
      proxy.destroy();
      ctx.postMessage({ type: 'file', id: msg.id, bytes: copy }, [copy.buffer]);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (msg.type === 'run') {
      ctx.postMessage({ type: 'result', id: msg.id, output: errorOutput(e), dfInfo: null });
    } else {
      ctx.postMessage({ type: 'error', id: msg.id, message });
    }
  }
}

ctx.onmessage = (ev: MessageEvent<InMessage>) => {
  // Serialise messages so a writeFile finishes before the next run starts.
  queue = queue
    .then(() => handle(ev.data))
    .catch((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      ctx.postMessage({ type: 'error', id: 'id' in ev.data ? ev.data.id : undefined, message });
    });
};
