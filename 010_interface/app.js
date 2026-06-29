// tool web UI - vanilla JS, no framework.

const state = {
  rootDir: null,
  openFile: null,
  pickerCurrent: null,
  terminals: {},      // id -> {cwd, log[]}
  activeTerm: null,
  nextTermId: 1,
};

// ---- session id (fragment-routed) -------------------------------------
// The URL fragment #s=<uuid> picks which server-side session this tab is
// attached to. Every /api/* request carries X-Tool-Session: <uuid> via
// the monkey-patched window.fetch below, so the server knows which
// session's SQLite + UI state to read/write. A missing fragment is
// handled in bootSession() (picker on cold start with >0 sessions; auto-
// create otherwise).
let currentSessionId = (() => {
  const m = /(?:^|&)s=([0-9a-f-]{32,40})/.exec(location.hash.replace(/^#/, ''));
  return m ? m[1] : null;
})();
function setSessionInUrl(id) {
  currentSessionId = id;
  if (id) {
    if (location.hash.replace(/^#/, '') !== 's=' + id) {
      history.replaceState(null, '', '#s=' + id);
    }
  }
}
// Monkey-patch fetch so every /api/* call tags the session id. Done once,
// before any other code runs, so existing fetch('/api/...') call sites
// don't need to change.
{
  const origFetch = window.fetch.bind(window);
  window.fetch = function(input, init) {
    const url = (typeof input === 'string') ? input :
                (input && input.url)        ? input.url : '';
    if (url.startsWith('/api/') && currentSessionId) {
      init = init || {};
      const h = new Headers(init.headers || {});
      h.set('X-Tool-Session', currentSessionId);
      init.headers = h;
    }
    return origFetch(input, init);
  };
}

// ---- status polling ---------------------------------------------------
async function pollStatus() {
  try {
    const r = await fetch('/api/status');
    const s = await r.json();
    document.title = s.ready ? 'tool — ready' : `tool — ${s.headline}`;
    document.getElementById('status').textContent = s.headline;
  } catch {
    document.title = 'tool — (server unreachable)';
  }
}
setInterval(pollStatus, 1500);
pollStatus();

// ---- menubar ----------------------------------------------------------
document.querySelectorAll('#menubar .menu-item').forEach(item => {
  item.addEventListener('click', e => {
    e.stopPropagation();
    document.querySelectorAll('#menubar .menu-item').forEach(o => {
      if (o !== item) o.classList.remove('open');
    });
    item.classList.toggle('open');
  });
});
document.addEventListener('click', e => {
  if (!e.target.closest('#menubar .menu-item')) {
    document.querySelectorAll('#menubar .menu-item').forEach(o => o.classList.remove('open'));
  }
});
document.querySelectorAll('[data-action]').forEach(el => {
  el.addEventListener('click', e => {
    e.stopPropagation();
    el.closest('.menu-item')?.classList.remove('open');
    handleMenuAction(el.dataset.action);
  });
});

function handleMenuAction(action) {
  switch (action) {
    case 'open-folder':     openFolderPicker(); break;
    case 'new-file':        createInRoot('file');   break;
    case 'new-folder':      createInRoot('folder'); break;
    case 'delete':          deleteSelected();   break;
    case 'quit':            fetch('/api/quit', {method:'POST'}); break;
    case 'clear-context':   clearContext(); break;
    case 'api-credentials': openCredsModal(); break;
    case 'switch-session':  openSessionPicker({ allowClose: true }); break;
    case 'rename-session':  promptRenameSession(); break;
    case 'new-session':     newSessionThenReload(); break;
    case 'forget-session':  forgetCurrentSession(); break;
  }
}

async function newSessionThenReload() {
  const m = await createSessionOnServer({});
  if (!m) return;
  setSessionInUrl(m.id);
  location.reload();
}

async function createSessionOnServer({ name = '', root_dir = '' }) {
  try {
    const r = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, root_dir }),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function promptRenameSession() {
  if (!currentSessionId) return;
  const name = prompt('Session name:', '');
  if (name === null) return;
  try {
    await fetch('/api/sessions/' + currentSessionId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  } catch {}
}

async function forgetCurrentSession() {
  if (!currentSessionId) return;
  if (!confirm('Forget this session? Its chat history and tab state are deleted.'))
    return;
  try {
    await fetch('/api/sessions/' + currentSessionId, { method: 'DELETE' });
  } catch {}
  // After forgetting, drop fragment and reload — bootSession() takes over.
  currentSessionId = null;
  history.replaceState(null, '', location.pathname);
  location.reload();
}

// ---- API credentials modal -------------------------------------------
const credsModal  = document.getElementById('creds-modal');
const credMouser  = document.getElementById('cred-mouser');
document.getElementById('creds-close') .addEventListener('click', () => credsModal.classList.add('hidden'));
document.getElementById('creds-cancel').addEventListener('click', () => credsModal.classList.add('hidden'));
document.getElementById('creds-save')  .addEventListener('click', saveCreds);
credsModal.addEventListener('click', e => { if (e.target === credsModal) credsModal.classList.add('hidden'); });
document.querySelectorAll('.creds-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = document.getElementById(btn.dataset.target);
    target.type = (target.type === 'password') ? 'text' : 'password';
  });
});

async function openCredsModal() {
  try {
    const r = await fetch('/api/settings');
    if (r.ok) {
      const s = await r.json();
      credMouser.value = (s.mouser && s.mouser.api_key) || '';
    }
  } catch {}
  credsModal.classList.remove('hidden');
}

async function saveCreds() {
  const body = {
    mouser: { api_key: credMouser.value.trim() },
  };
  try {
    const r = await fetch('/api/settings', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      alert('save failed: ' + r.status);
      return;
    }
    credsModal.classList.add('hidden');
  } catch (err) {
    alert('save failed: ' + err.message);
  }
}

// Also wire the AI pane's brain-icon dropdown the same way as the top menu.
document.querySelectorAll('.ai-menu').forEach(item => {
  item.addEventListener('click', e => {
    e.stopPropagation();
    document.querySelectorAll('.menu-item').forEach(o => {
      if (o !== item) o.classList.remove('open');
    });
    item.classList.toggle('open');
  });
});

async function clearContext() {
  try {
    const r = await fetch('/api/context/clear', { method: 'POST' });
    if (r.ok) {
      const j = await r.json().catch(() => ({}));
      // The server hands us back a fresh session id; ride the wave so
      // subsequent /api/chat calls write to the new SQLite.
      if (j.id) setSessionInUrl(j.id);
    }
  } catch {}
  chatLog.innerHTML = '';
}

// ---- session picker modal --------------------------------------------
const sessionModal = document.getElementById('session-modal');
const sessionList  = document.getElementById('session-list');
document.getElementById('session-close') ?.addEventListener('click', closeSessionPicker);
document.getElementById('session-new')   ?.addEventListener('click', async () => {
  const m = await createSessionOnServer({});
  if (!m) return;
  setSessionInUrl(m.id);
  location.reload();
});
sessionModal?.addEventListener('click', e => {
  if (e.target === sessionModal && sessionModal.dataset.allowClose === '1') {
    closeSessionPicker();
  }
});

function closeSessionPicker() {
  sessionModal.classList.add('hidden');
}

async function openSessionPicker({ allowClose = true, sessions = null } = {}) {
  sessionModal.dataset.allowClose = allowClose ? '1' : '0';
  document.getElementById('session-close').style.display =
    allowClose ? '' : 'none';

  if (!sessions) {
    try {
      const r = await fetch('/api/sessions');
      if (r.ok) sessions = (await r.json()).sessions || [];
      else sessions = [];
    } catch { sessions = []; }
  }

  sessionList.innerHTML = '';
  if (!sessions.length) {
    const empty = document.createElement('div');
    empty.className = 'session-empty hint';
    empty.textContent = 'No sessions yet. Click "+ New session" to start one.';
    sessionList.appendChild(empty);
  }
  for (const s of sessions) {
    const row = document.createElement('div');
    row.className = 'session-row' + (s.active ? ' active' : '');
    row.innerHTML =
      `<div class="meta">` +
        `<div class="name"></div>` +
        `<div class="folder"></div>` +
      `</div>` +
      `<div class="stats"></div>` +
      `<div class="last"></div>` +
      `<button class="forget-btn" title="Forget this session">×</button>`;
    row.querySelector('.name').textContent  =
      s.name || abbrPath(s.root_dir) || 'untitled';
    row.querySelector('.folder').textContent = abbrPath(s.root_dir) || '(no folder)';
    row.querySelector('.stats').textContent  =
      `${s.message_count || 0} msgs`;
    row.querySelector('.last').textContent   = humanAgo(s.last_active);
    row.title = s.id;
    row.addEventListener('click', e => {
      if (e.target.classList.contains('forget-btn')) return;
      setSessionInUrl(s.id);
      location.reload();
    });
    row.querySelector('.forget-btn').addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm(`Forget "${row.querySelector('.name').textContent}"? ` +
                   `Chat history and tab state are deleted.`)) return;
      try { await fetch('/api/sessions/' + s.id, { method: 'DELETE' }); } catch {}
      row.remove();
      // If we just nuked the active session and the picker was modal, refresh.
      if (s.active) {
        currentSessionId = null;
        history.replaceState(null, '', location.pathname);
        location.reload();
      }
    });
    sessionList.appendChild(row);
  }
  sessionModal.classList.remove('hidden');
}

function humanAgo(ts) {
  if (!ts) return '';
  const d = Date.now() - ts;
  if (d < 60_000)        return 'just now';
  if (d < 3_600_000)     return Math.round(d / 60_000) + ' min ago';
  if (d < 86_400_000)    return Math.round(d / 3_600_000) + ' hr ago';
  if (d < 86_400_000 * 7) return Math.round(d / 86_400_000) + ' day' +
                                 (Math.round(d / 86_400_000) === 1 ? '' : 's') + ' ago';
  return new Date(ts).toLocaleDateString();
}
function abbrPath(p) {
  if (!p) return '';
  const home = ['/home/', '/Users/'].find(prefix => p.startsWith(prefix));
  if (home) {
    const rest = p.slice(home.length).split('/');
    if (rest.length > 1) return '~/' + rest.slice(1).join('/');
  }
  return p;
}

// ---- pane hide/show + drag resize -------------------------------------
const paneToggles = document.querySelectorAll('.pane-toggle');
paneToggles.forEach(btn => {
  btn.classList.add('active');
  btn.addEventListener('click', () => {
    const targetId = btn.dataset.toggle;
    const target = document.getElementById(targetId);
    if (!target) return;
    const collapsed = target.classList.toggle('collapsed');
    btn.classList.toggle('active', !collapsed);
    if (targetId === 'pane-files') {
      document.querySelector('.resizer[data-target="pane-files"]')?.classList.toggle('collapsed', collapsed);
    } else if (targetId === 'pane-chat') {
      document.querySelector('.resizer[data-target="pane-chat"]')?.classList.toggle('collapsed', collapsed);
    } else if (targetId === 'terminal-bar') {
      document.getElementById('resizer-terminal')?.classList.toggle('collapsed', collapsed);
      document.body.style.gridTemplateRows = collapsed
        ? '28px 1fr 0 0'
        : `28px 1fr 4px var(--term-h)`;
    }
    updateLayoutColumns();
  });
});

function updateLayoutColumns() {
  const filesHidden = document.getElementById('pane-files').classList.contains('collapsed');
  const chatHidden  = document.getElementById('pane-chat').classList.contains('collapsed');
  const layout = document.getElementById('layout');
  // Build a five-track grid (files, resizer, editor, resizer, chat).
  // Collapsed panes/resizers contribute 0 width.
  const fw = filesHidden ? '0' : 'var(--files-w)';
  const fr = filesHidden ? '0' : '4px';
  const cw = chatHidden  ? '0' : 'var(--chat-w)';
  const cr = chatHidden  ? '0' : '4px';
  layout.style.gridTemplateColumns = `${fw} ${fr} 1fr ${cr} ${cw}`;
}
updateLayoutColumns();

document.querySelectorAll('.resizer').forEach(rz => {
  rz.addEventListener('mousedown', startColResize);
});
document.getElementById('resizer-terminal').addEventListener('mousedown', startRowResize);

function startColResize(e) {
  const target = e.currentTarget.dataset.target;     // 'pane-files' or 'pane-chat'
  const isLeft = target === 'pane-files';
  e.preventDefault();
  const startX = e.clientX;
  const root = document.documentElement;
  const startW = parseInt(getComputedStyle(root).getPropertyValue(isLeft ? '--files-w' : '--chat-w'));
  function move(ev) {
    const dx = ev.clientX - startX;
    const nw = Math.max(120, Math.min(800, startW + (isLeft ? dx : -dx)));
    root.style.setProperty(isLeft ? '--files-w' : '--chat-w', nw + 'px');
    updateLayoutColumns();
  }
  function up() {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
  }
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}
function startRowResize(e) {
  e.preventDefault();
  const startY = e.clientY;
  const root = document.documentElement;
  const startH = parseInt(getComputedStyle(root).getPropertyValue('--term-h'));
  function move(ev) {
    const dy = startY - ev.clientY;
    const nh = Math.max(80, Math.min(window.innerHeight - 200, startH + dy));
    root.style.setProperty('--term-h', nh + 'px');
    document.body.style.gridTemplateRows = `28px 1fr 4px ${nh}px`;
  }
  function up() {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
  }
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

// ---- folder picker modal ----------------------------------------------
const picker      = document.getElementById('folder-picker');
const pickerList  = document.getElementById('picker-list');
const pickerPath  = document.getElementById('picker-path');

function openFolderPicker() {
  picker.classList.remove('hidden');
  loadPickerPath(state.rootDir || '~');
}
function closeFolderPicker() { picker.classList.add('hidden'); }
document.getElementById('picker-close').addEventListener('click', closeFolderPicker);
document.getElementById('picker-cancel').addEventListener('click', closeFolderPicker);
document.getElementById('picker-up').addEventListener('click', async () => {
  const data = await fsList(state.pickerCurrent);
  if (data) loadPickerPath(data.parent);
});
document.getElementById('picker-go').addEventListener('click', () => loadPickerPath(pickerPath.value.trim()));
pickerPath.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); loadPickerPath(pickerPath.value.trim()); }
});
document.getElementById('picker-open').addEventListener('click', () => {
  if (state.pickerCurrent) commitOpenFolder(state.pickerCurrent);
});
picker.addEventListener('click', e => { if (e.target === picker) closeFolderPicker(); });

async function fsList(path) {
  try {
    const r = await fetch('/api/fs/list?path=' + encodeURIComponent(path));
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function loadPickerPath(path) {
  const data = await fsList(path);
  if (!data) {
    pickerList.innerHTML = `<li class="is-file">cannot read ${escapeHTML(path)}</li>`;
    return;
  }
  state.pickerCurrent = data.path;
  pickerPath.value = data.path;
  pickerList.innerHTML = '';
  for (const e of data.entries) {
    const li = document.createElement('li');
    li.textContent = e.name;
    if (!e.is_dir) li.classList.add('is-file');
    else li.addEventListener('click', () => loadPickerPath(joinPath(data.path, e.name)));
    pickerList.appendChild(li);
  }
}
function joinPath(base, name) {
  return base.endsWith('/') ? base + name : base + '/' + name;
}
async function commitOpenFolder(path) {
  // Dirty-aware close of all open files before switching folders.
  const dirtyPaths = Object.entries(state.files)
    .filter(([_, f]) => f.dirty)
    .map(([p]) => p);
  if (dirtyPaths.length) {
    const list = dirtyPaths.map(p => '  • ' + p.split('/').pop()).join('\n');
    const choice = window.prompt(
      `Unsaved changes in ${dirtyPaths.length} file(s):\n${list}\n\n` +
      `Type:\n  s  -> save all & switch folder\n  d  -> discard all & switch\n  c  -> cancel folder change`,
      's'
    );
    if (choice === null || choice.toLowerCase().startsWith('c')) {
      closeFolderPicker();
      return;  // cancel
    }
    if (choice.toLowerCase().startsWith('s')) {
      for (const p of dirtyPaths) {
        const f = state.files[p];
        if (!f) continue;
        await saveFile(p, f.getContent());
      }
    }
    // 'd' (discard) falls through, files are closed without saving below
  }

  // Close every open file (destroy editors, remove tabs).
  for (const p of Object.keys(state.files)) {
    const f = state.files[p];
    if (f) {
      try { f.destroy(); } catch {}
      f.surface.remove();
      f.tab.remove();
    }
    delete state.files[p];
  }
  state.activeFilePath = null;
  // Re-show the placeholder.
  if (!editorBody.querySelector('.editor-empty')) {
    const empty = document.createElement('div');
    empty.className = 'editor-empty hint';
    empty.textContent = 'No file open.';
    editorBody.appendChild(empty);
  }

  state.rootDir = path;
  document.getElementById('files-root').textContent = path;
  // Close every existing terminal and open a fresh one rooted at the new folder.
  for (const id of Object.keys(state.terminals)) closeTerminal(id);
  newTerminal();
  closeFolderPicker();
  refreshFileTree();
}

// ---- file tree (left pane) --------------------------------------------
const filesTree = document.getElementById('files-tree');
async function refreshFileTree() {
  if (!state.rootDir) {
    filesTree.innerHTML = '<em class="hint">Open a folder to begin (File → Open Folder)</em>';
    return;
  }
  const data = await fsList(state.rootDir);
  if (!data) { filesTree.innerHTML = '<em class="hint">cannot read folder</em>'; return; }
  filesTree.innerHTML = '';
  renderEntries(filesTree, data.path, data.entries);
}
function renderEntries(into, parentPath, entries) {
  for (const e of entries) {
    const node = document.createElement('div');
    node.className = 'fs-node ' + (e.is_dir ? 'fs-dir' : 'fs-file');
    node.dataset.path = joinPath(parentPath, e.name);
    node.innerHTML = `<div class="fs-name">${escapeHTML(e.name)}</div>`;
    if (e.is_dir) {
      const kids = document.createElement('div');
      kids.className = 'fs-children hidden';
      node.appendChild(kids);
      node.querySelector('.fs-name').addEventListener('click', async ev => {
        ev.stopPropagation();
        kids.classList.toggle('hidden');
        if (!kids.classList.contains('hidden') && kids.children.length === 0) {
          const sub = await fsList(node.dataset.path);
          if (sub) renderEntries(kids, sub.path, sub.entries);
        }
      });
    } else {
      node.querySelector('.fs-name').addEventListener('click', () => openFile(node.dataset.path));
      // Make file rows draggable so the user can drop an image onto the AI
      // pane to trigger a vision analysis (or onto anywhere else that wires
      // up a drop handler in the future).
      node.draggable = true;
      node.addEventListener('dragstart', ev => {
        ev.dataTransfer.setData('text/x-tool-path', node.dataset.path);
        ev.dataTransfer.setData('text/plain',       node.dataset.path);
        ev.dataTransfer.effectAllowed = 'copy';
      });
    }
    into.appendChild(node);
  }
}
const editorBody  = document.getElementById('editor-body');
const editorTabs  = document.getElementById('editor-tabs');

// Per-open-file state:
//   state.files[path] = {
//     mode:          'markdown'|'prose'|'code'|'unknown',
//     savedContent:  string (last saved content),
//     surface:       <div.editor-surface> DOM element
//     tab:           <div.editor-tab> DOM element
//     getContent():  () -> current content string
//     destroy():     () -> cleanup (e.g. mdEditor.destroy())
//   }
state.files = state.files || {};
state.activeFilePath = state.activeFilePath || null;

const EDITOR_MODES = {
  markdown: new Set(['md','markdown']),
  prose:    new Set(['txt','rst','text']),
  code:     new Set(['c','cc','cpp','cxx','h','hpp','hxx',
                     'js','mjs','ts','tsx','jsx','html','htm','css','json',
                     'py','sh','bash','zsh','rb','go','rs','java','kt',
                     'lua','pl','php','sql','yml','yaml','toml','ini','cfg',
                     'xml','svg','log','cmake','make','makefile','dockerfile']),
  pdf:      new Set(['pdf']),
  image:    new Set(['png','jpg','jpeg','gif','webp','ico','bmp']),
};

function detectMode(path) {
  const fname = path.split('/').pop().toLowerCase();
  if (fname === 'makefile' || fname === 'dockerfile' || fname === 'cmakelists.txt') return 'code';
  const ext = fname.includes('.') ? fname.split('.').pop() : '';
  if (EDITOR_MODES.markdown.has(ext)) return 'markdown';
  if (EDITOR_MODES.prose.has(ext))    return 'prose';
  if (EDITOR_MODES.code.has(ext))     return 'code';
  if (EDITOR_MODES.pdf.has(ext))      return 'pdf';
  if (EDITOR_MODES.image.has(ext))    return 'image';
  return 'unknown';
}

async function openFile(path) {
  // Already open? Just switch to that tab.
  if (state.files[path]) {
    activateFile(path);
    return;
  }

  // Hide the "no file open" placeholder once we have content.
  const empty = editorBody.querySelector('.editor-empty');
  if (empty) empty.remove();

  const r = await fetch('/api/fs/read?path=' + encodeURIComponent(path));
  if (!r.ok) {
    const w = document.createElement('div');
    w.className = 'editor-readonly';
    w.textContent = 'cannot read ' + path;
    editorBody.appendChild(w);
    return;
  }
  const j = await r.json();
  const mode = detectMode(path);

  // Build surface (the per-file editor container, absolutely positioned).
  const surface = document.createElement('div');
  surface.className = 'editor-surface';
  surface.dataset.path = path;
  editorBody.appendChild(surface);

  // CRITICAL: make this surface visible BEFORE constructing the editor.
  // Toast UI Editor (and to a lesser extent <textarea>) measures container
  // dimensions on instantiation; a `display:none` container yields zero
  // dimensions and the editor renders blank. Hide existing surfaces first,
  // show this new one, THEN construct.
  for (const ff of Object.values(state.files)) ff.surface.classList.remove('active');
  surface.classList.add('active');

  // ---- Binary modes ----
  // PDF: read-only iframe embed.
  if (mode === 'pdf') {
    state.files[path] = {
      mode, savedContent: '',
      surface, tab: null,
      getContent: () => '',
      destroy: () => {},
      dirty: false,
    };
    const iframe = document.createElement('iframe');
    iframe.className = 'pdf-embed';
    iframe.src = '/api/fs/raw?path=' + encodeURIComponent(path);
    surface.appendChild(iframe);
    buildEditorTab(path, mode);
    activateFile(path);
    saveState();
    return;
  }

  // Image: view (img tag) OR edit (canvas paint UI). Toggle via tab button.
  if (mode === 'image') {
    state.files[path] = {
      mode, savedContent: '',
      surface, tab: null,
      getContent: () => '',
      destroy: () => {},
      dirty: false,
      imgMode: 'view',
      paint: null,     // populated when entering edit mode
    };

    const viewWrap = document.createElement('div');
    viewWrap.className = 'image-view-wrap active';
    const img = document.createElement('img');
    img.className = 'image-embed';
    img.src = '/api/fs/raw?path=' + encodeURIComponent(path) +
              '&_t=' + Date.now();    // cache-bust so re-opens see edits
    img.draggable = true;
    img.addEventListener('dragstart', ev => {
      ev.dataTransfer.setData('text/x-tool-path', path);
      ev.dataTransfer.setData('text/plain',       path);
      ev.dataTransfer.effectAllowed = 'copy';
    });
    viewWrap.appendChild(img);
    surface.appendChild(viewWrap);

    // Edit surface (canvas + paint toolbar) is lazy — only built when the
    // user toggles to edit mode for the first time.
    state.files[path].buildPaint = () => {
      if (state.files[path].paint) return;
      const paintWrap = document.createElement('div');
      paintWrap.className = 'image-edit-wrap';
      surface.appendChild(paintWrap);
      const paint = buildPaintEditor(paintWrap, img, path);
      state.files[path].paint = paint;
    };

    state.files[path].setImgMode = (m) => {
      const f = state.files[path];
      if (!f) return;
      if (m === 'edit') f.buildPaint();
      // Toggling back to view: refresh the <img> from the live canvas so
      // unsaved edits are still visible. (When saved, the file is also
      // re-fetched fresh — both paths converge on showing current state.)
      if (m === 'view' && f.paint) {
        const v = f.surface.querySelector('.image-view-wrap img');
        if (v) v.src = f.paint.snapshotDataURL();
      }
      f.imgMode = m;
      const v = f.surface.querySelector('.image-view-wrap');
      const e = f.surface.querySelector('.image-edit-wrap');
      if (v) v.classList.toggle('active', m === 'view');
      if (e) e.classList.toggle('active', m === 'edit');
    };

    buildEditorTab(path, mode);
    activateFile(path);
    saveState();
    return;
  }

  // Register the file in state EARLY (before any editor construction) so
  // change handlers that fire during init don't NPE on state.files[path].
  state.files[path] = {
    mode, savedContent: j.content,
    surface, tab: null,
    getContent: () => j.content,
    destroy: () => {},
    dirty: false,
  };

  let getContent;
  let destroy = () => {};

  if (mode === 'markdown' && typeof toastui !== 'undefined') {
    const host = document.createElement('div');
    host.className = 'md-editor-host';
    surface.appendChild(host);
    // Force a layout pass so the host has real dimensions BEFORE Toast UI
    // measures it. Otherwise Toast UI sometimes throws or renders blank.
    await new Promise(r => requestAnimationFrame(r));
    void host.offsetHeight;
    try {
      const editor = new toastui.Editor({
        el: host,
        initialValue: j.content,
        // Hide Toast UI's bottom-right mode switch; we put our own toggle
        // ON the tab (see addMdModeToggle below).
        previewStyle: 'vertical',
        initialEditType: 'markdown',
        previewHighlight: true,
        theme: 'dark',
        height: '100%',
        usageStatistics: false,
        hideModeSwitch: true,
        toolbarItems: [
          ['heading','bold','italic','strike'],
          ['hr','quote'],
          ['ul','ol','task','indent','outdent'],
          ['table','link','image'],
          ['code','codeblock'],
        ],
      });
      editor.on('change', () => {
        const v = editor.getMarkdown();
        const f = state.files[path];
        if (f) setFileDirty(path, v !== f.savedContent);
      });
      getContent = () => editor.getMarkdown();
      destroy    = () => { try { editor.destroy(); } catch {} };
      // Stash a mode-switch callback so the tab toggle can drive it.
      state.files[path].changeMode = (m) => {
        try { editor.changeMode(m); } catch {}
        state.files[path].mdMode = m;
      };
      state.files[path].mdMode = 'markdown';
    } catch (err) {
      // Toast UI blew up. Fall back to a plain textarea showing the source
      // so the user can at least see + edit the markdown. Surface the
      // error visibly above the textarea so we can diagnose.
      console.error('Toast UI editor failed:', err);
      host.remove();
      const errBar = document.createElement('div');
      errBar.style.cssText = 'background:#7a3030;color:#fff;padding:4px 8px;font-size:11px;';
      errBar.textContent = 'Markdown engine failed (' + (err && err.message ? err.message : 'unknown') + ') — falling back to plain text editor.';
      surface.appendChild(errBar);
      const ta = document.createElement('textarea');
      ta.className = 'editor-textarea prose';
      ta.spellcheck = true;
      ta.value = j.content;
      ta.addEventListener('input', () => {
        const f = state.files[path];
        if (f) setFileDirty(path, ta.value !== f.savedContent);
      });
      ta.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault();
          saveFile(path, ta.value);
        }
      });
      surface.appendChild(ta);
      getContent = () => ta.value;
    }
  } else if (mode === 'prose' || mode === 'code') {
    const ta = document.createElement('textarea');
    ta.className = 'editor-textarea' + (mode === 'prose' ? ' prose' : '');
    ta.spellcheck = (mode === 'prose');
    ta.value = j.content;
    ta.addEventListener('input', () => {
      setFileDirty(path, ta.value !== state.files[path].savedContent);
    });
    ta.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveFile(path, ta.value);
      }
    });
    surface.appendChild(ta);
    getContent = () => ta.value;
  } else {
    const wrap = document.createElement('div');
    wrap.className = 'editor-readonly';
    const pre = document.createElement('pre');
    pre.textContent = j.content;
    wrap.appendChild(pre);
    surface.appendChild(wrap);
    getContent = () => j.content;
  }

  const tab = buildEditorTab(path, mode);

  // Finalize the state entry — overwrite the early placeholder we wrote
  // before editor construction with the real getContent / destroy + tab.
  state.files[path].tab        = tab;
  state.files[path].getContent = getContent;
  state.files[path].destroy    = destroy;

  activateFile(path);
  saveState();
}

function buildEditorTab(path, mode) {
  const tab = document.createElement('div');
  tab.className = 'editor-tab';
  tab.dataset.path = path;
  let extra = '';
  if (mode === 'markdown') {
    extra = `<button class="md-toggle" title="Switch markdown source / rendered">Source</button>`;
  } else if (mode === 'image') {
    extra =
      `<button class="img-toggle" title="Toggle view / edit">Edit</button>` +
      `<button class="img-describe" title="Ask the vision AI to describe this image">🧠</button>`;
  }
  tab.innerHTML =
    `<span class="dirty">●</span>` +
    `<span class="label"></span>` +
    extra +
    `<span class="x" title="Close">×</span>`;
  tab.querySelector('.label').textContent = path.split('/').pop();
  tab.title = path;
  tab.addEventListener('click', e => {
    if (e.target.classList.contains('x'))            return;
    if (e.target.classList.contains('md-toggle'))    return;
    if (e.target.classList.contains('img-toggle'))   return;
    if (e.target.classList.contains('img-describe')) return;
    activateFile(path);
  });
  tab.querySelector('.x').addEventListener('click', e => {
    e.stopPropagation();
    closeFile(path);
  });
  if (mode === 'markdown') {
    const btn = tab.querySelector('.md-toggle');
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const f = state.files[path];
      if (!f) return;
      if (!f.changeMode) {
        btn.textContent = '(no md engine)';
        return;
      }
      const next = (f.mdMode === 'markdown') ? 'wysiwyg' : 'markdown';
      f.changeMode(next);
      btn.textContent = (next === 'markdown') ? 'Source' : 'Rendered';
    });
  } else if (mode === 'image') {
    const tbtn = tab.querySelector('.img-toggle');
    tbtn.addEventListener('click', e => {
      e.stopPropagation();
      const f = state.files[path];
      if (!f || !f.setImgMode) return;
      const next = (f.imgMode === 'view') ? 'edit' : 'view';
      f.setImgMode(next);
      tbtn.textContent = (next === 'view') ? 'Edit' : 'View';
    });
    tab.querySelector('.img-describe').addEventListener('click', e => {
      e.stopPropagation();
      analyzeImage(path);
    });
  }
  editorTabs.appendChild(tab);

  // For binary modes the state entry needs the tab linked too.
  if (state.files[path]) state.files[path].tab = tab;

  return tab;
}

// ===== Image paint editor (MS-Paint-style) ==============================
// Builds a canvas + toolbar inside `host`. Returns an object exposing
// .save(), .undo(), .redo(), .copy(), .cut(), .paste(), .pasteBlob(),
// .deleteSelection(), .hasSelection(), .getCanvas(), .zoom(direction).
// Saving is keyboard-only (Ctrl+S); the toolbar has tools / color / size
// / zoom — no save button.
function buildPaintEditor(host, srcImg, path) {
  const toolbar = document.createElement('div');
  toolbar.className = 'paint-toolbar';
  toolbar.innerHTML =
    `<button data-tool="brush"  class="paint-tool active" title="Brush">✎</button>` +
    `<button data-tool="eraser" class="paint-tool"        title="Eraser">⌫</button>` +
    `<button data-tool="line"   class="paint-tool"        title="Line">／</button>` +
    `<button data-tool="rect"   class="paint-tool"        title="Rectangle">▭</button>` +
    `<button data-tool="select" class="paint-tool"        title="Select (drag a rectangle, then Ctrl+C / Ctrl+X / Ctrl+V / Del)">⛶</button>` +
    `<span class="paint-sep"></span>` +
    `<input  type="color" class="paint-color" value="#ff2222" title="Color">` +
    `<input  type="range" class="paint-size"  min="1" max="60" value="4" title="Brush size">` +
    `<span   class="paint-size-label">4px</span>` +
    `<span class="paint-sep"></span>` +
    `<button class="paint-undo"     title="Undo (Ctrl+Z)">↶</button>` +
    `<button class="paint-redo"     title="Redo (Ctrl+Y)">↷</button>` +
    `<span class="paint-sep"></span>` +
    `<button class="paint-zoom-out" title="Zoom out (Ctrl+Wheel)">−</button>` +
    `<span class="paint-zoom-label" title="Zoom (click to reset)">100%</span>` +
    `<button class="paint-zoom-in"  title="Zoom in (Ctrl+Wheel)">+</button>`;
  host.appendChild(toolbar);

  // Canvas stack: base (committed pixels) + overlay (preview / selection).
  // .paint-canvases wraps both and grows / shrinks with zoom.
  const stack = document.createElement('div');
  stack.className = 'paint-stack';
  host.appendChild(stack);
  const inner = document.createElement('div');
  inner.className = 'paint-canvases';
  stack.appendChild(inner);
  const base    = document.createElement('canvas');
  const overlay = document.createElement('canvas');
  base.className    = 'paint-canvas base';
  overlay.className = 'paint-canvas overlay';
  inner.appendChild(base);
  inner.appendChild(overlay);

  const st = {
    tool: 'brush',
    color: '#ff2222',
    size: 4,
    zoom: 1,
    drawing: false,
    startX: 0, startY: 0,
    lastX: 0,  lastY: 0,
    selection: null,         // {x, y, w, h} in canvas pixels
    selecting: false,        // mid-drag for select tool
    clipboard: null,         // HTMLCanvasElement holding copied pixels
  };

  const bctx = base.getContext('2d');
  const octx = overlay.getContext('2d');

  // ----- canvas init + zoom ---------------------------------------------
  const applyZoom = () => {
    const w = base.width  * st.zoom;
    const h = base.height * st.zoom;
    inner.style.width    = w + 'px';
    inner.style.height   = h + 'px';
    base.style.width     = w + 'px';
    base.style.height    = h + 'px';
    overlay.style.width  = w + 'px';
    overlay.style.height = h + 'px';
    const pct = Math.round(st.zoom * 100);
    toolbar.querySelector('.paint-zoom-label').textContent = pct + '%';
  };
  const initCanvases = () => {
    const w = srcImg.naturalWidth  || srcImg.width  || 600;
    const h = srcImg.naturalHeight || srcImg.height || 400;
    base.width    = w; base.height    = h;
    overlay.width = w; overlay.height = h;
    bctx.drawImage(srcImg, 0, 0, w, h);
    applyZoom();
  };
  if (srcImg.complete && srcImg.naturalWidth) initCanvases();
  else srcImg.addEventListener('load', initCanvases, { once: true });

  // ----- toolbar wiring -------------------------------------------------
  toolbar.querySelectorAll('.paint-tool').forEach(btn => {
    btn.addEventListener('click', () => {
      st.tool = btn.dataset.tool;
      toolbar.querySelectorAll('.paint-tool').forEach(b =>
        b.classList.toggle('active', b === btn));
      // Switching tools clears any drag-in-progress preview.
      if (st.tool !== 'select') { clearSelection(); }
      redrawOverlay();
    });
  });
  toolbar.querySelector('.paint-color').addEventListener('input', e => {
    st.color = e.target.value;
  });
  const sizeInput = toolbar.querySelector('.paint-size');
  const sizeLabel = toolbar.querySelector('.paint-size-label');
  sizeInput.addEventListener('input', e => {
    st.size = parseInt(e.target.value, 10);
    sizeLabel.textContent = st.size + 'px';
  });
  toolbar.querySelector('.paint-undo').addEventListener('click', () => undo());
  toolbar.querySelector('.paint-redo').addEventListener('click', () => redo());
  toolbar.querySelector('.paint-zoom-in').addEventListener('click',
    () => zoom(+1));
  toolbar.querySelector('.paint-zoom-out').addEventListener('click',
    () => zoom(-1));
  toolbar.querySelector('.paint-zoom-label').addEventListener('click',
    () => zoomReset());

  // ----- pointer helpers ------------------------------------------------
  // Map a pointer event to canvas-pixel coordinates (handles CSS scaling).
  const ptFromEvent = e => {
    const r = base.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (base.width  / r.width),
      y: (e.clientY - r.top)  * (base.height / r.height),
    };
  };

  const drawStroke = (ctx, x0, y0, x1, y1) => {
    ctx.lineCap   = 'round';
    ctx.lineJoin  = 'round';
    ctx.strokeStyle = st.color;
    ctx.lineWidth = st.size;
    ctx.globalCompositeOperation = (st.tool === 'eraser')
      ? 'destination-out' : 'source-over';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  };

  // ----- undo / redo ----------------------------------------------------
  const undoStack = [];
  const redoStack = [];
  const MAX_UNDO = 30;
  const snapshot = () => {
    const c = document.createElement('canvas');
    c.width = base.width; c.height = base.height;
    c.getContext('2d').drawImage(base, 0, 0);
    return c;
  };
  const pushUndo = () => {
    undoStack.push(snapshot());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
  };
  const restoreSnapshot = src => {
    bctx.globalCompositeOperation = 'source-over';
    bctx.clearRect(0, 0, base.width, base.height);
    bctx.drawImage(src, 0, 0);
  };
  const undo = () => {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    restoreSnapshot(undoStack.pop());
    markImageDirty(path);
  };
  const redo = () => {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    restoreSnapshot(redoStack.pop());
    markImageDirty(path);
  };

  // ----- selection ------------------------------------------------------
  const clearSelection = () => { st.selection = null; };
  let antsTimer = null;
  let antsOffset = 0;
  const startAnts = () => {
    if (antsTimer) return;
    antsTimer = setInterval(() => {
      antsOffset = (antsOffset + 1) % 8;
      redrawOverlay();
    }, 100);
  };
  const stopAnts = () => { if (antsTimer) { clearInterval(antsTimer); antsTimer = null; } };
  const redrawOverlay = () => {
    octx.clearRect(0, 0, overlay.width, overlay.height);
    if (st.selection) {
      const { x, y, w, h } = st.selection;
      octx.lineWidth = Math.max(1, 1 / st.zoom);
      octx.setLineDash([4, 4]);
      octx.lineDashOffset = -antsOffset;
      octx.strokeStyle = '#000';
      octx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      octx.strokeStyle = '#fff';
      octx.lineDashOffset = -antsOffset + 4;
      octx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      octx.setLineDash([]);
      startAnts();
    } else {
      stopAnts();
    }
  };

  // ----- pointer events on overlay -------------------------------------
  overlay.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    overlay.setPointerCapture(e.pointerId);
    const p = ptFromEvent(e);
    st.drawing = true;
    st.startX = p.x; st.startY = p.y;
    st.lastX  = p.x; st.lastY  = p.y;
    if (st.tool === 'select') {
      st.selecting = true;
      clearSelection();
      stopAnts();
      octx.clearRect(0, 0, overlay.width, overlay.height);
      return;
    }
    // Any non-select drawing tool: snapshot for undo, then start.
    pushUndo();
    if (st.tool === 'brush' || st.tool === 'eraser') {
      drawStroke(bctx, p.x, p.y, p.x + 0.01, p.y + 0.01);  // dot
    }
  });
  overlay.addEventListener('pointermove', e => {
    if (!st.drawing) return;
    const p = ptFromEvent(e);
    if (st.tool === 'brush' || st.tool === 'eraser') {
      drawStroke(bctx, st.lastX, st.lastY, p.x, p.y);
      st.lastX = p.x; st.lastY = p.y;
      markImageDirty(path);
    } else if (st.tool === 'select') {
      const sx = Math.min(st.startX, p.x);
      const sy = Math.min(st.startY, p.y);
      const sw = Math.abs(p.x - st.startX);
      const sh = Math.abs(p.y - st.startY);
      st.selection = { x: sx, y: sy, w: sw, h: sh };
      redrawOverlay();
    } else {
      // Live shape preview on overlay.
      octx.clearRect(0, 0, overlay.width, overlay.height);
      octx.strokeStyle = st.color;
      octx.lineWidth   = st.size;
      octx.lineCap     = 'round';
      if (st.tool === 'line') {
        octx.beginPath();
        octx.moveTo(st.startX, st.startY);
        octx.lineTo(p.x, p.y);
        octx.stroke();
      } else if (st.tool === 'rect') {
        const x = Math.min(st.startX, p.x);
        const y = Math.min(st.startY, p.y);
        const w = Math.abs(p.x - st.startX);
        const h = Math.abs(p.y - st.startY);
        octx.strokeRect(x, y, w, h);
      }
    }
  });
  overlay.addEventListener('pointerup', e => {
    if (!st.drawing) return;
    st.drawing = false;
    const p = ptFromEvent(e);
    if (st.tool === 'select') {
      st.selecting = false;
      if (st.selection && (st.selection.w < 2 || st.selection.h < 2)) {
        clearSelection();
        octx.clearRect(0, 0, overlay.width, overlay.height);
      } else {
        redrawOverlay();
      }
      return;
    }
    if (st.tool === 'line') {
      drawStroke(bctx, st.startX, st.startY, p.x, p.y);
    } else if (st.tool === 'rect') {
      bctx.strokeStyle = st.color;
      bctx.lineWidth   = st.size;
      const x = Math.min(st.startX, p.x);
      const y = Math.min(st.startY, p.y);
      const w = Math.abs(p.x - st.startX);
      const h = Math.abs(p.y - st.startY);
      bctx.strokeRect(x, y, w, h);
    }
    octx.clearRect(0, 0, overlay.width, overlay.height);
    markImageDirty(path);
  });

  // ----- zoom -----------------------------------------------------------
  const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16];
  const zoom = dir => {
    const i = ZOOM_STEPS.findIndex(z => Math.abs(z - st.zoom) < 0.001);
    const cur = (i >= 0) ? i : ZOOM_STEPS.findIndex(z => z >= st.zoom);
    const next = Math.max(0, Math.min(ZOOM_STEPS.length - 1,
                                      (cur < 0 ? ZOOM_STEPS.length - 1 : cur) + dir));
    st.zoom = ZOOM_STEPS[next];
    applyZoom();
    redrawOverlay();
  };
  const zoomReset = () => { st.zoom = 1; applyZoom(); redrawOverlay(); };

  // Ctrl+Wheel anywhere in the stack zooms (centered on cursor).
  stack.addEventListener('wheel', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    zoom(e.deltaY < 0 ? +1 : -1);
  }, { passive: false });

  // ----- copy / cut / paste / delete -----------------------------------
  const copyRegion = () => {
    if (!st.selection) return null;
    const { x, y, w, h } = st.selection;
    const tmp = document.createElement('canvas');
    tmp.width = Math.max(1, Math.round(w));
    tmp.height = Math.max(1, Math.round(h));
    tmp.getContext('2d').drawImage(
      base, Math.round(x), Math.round(y),
      tmp.width, tmp.height, 0, 0, tmp.width, tmp.height);
    return tmp;
  };
  const writeToSystemClipboard = canvas => {
    if (!navigator.clipboard || !window.ClipboardItem) return;
    canvas.toBlob(blob => {
      if (!blob) return;
      try {
        navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
          .catch(() => {});
      } catch {}
    }, 'image/png');
  };

  const copy = () => {
    const c = copyRegion();
    if (!c) return;
    st.clipboard = c;
    writeToSystemClipboard(c);
  };
  const cut = () => {
    const c = copyRegion();
    if (!c) return;
    st.clipboard = c;
    writeToSystemClipboard(c);
    pushUndo();
    const { x, y, w, h } = st.selection;
    bctx.clearRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    markImageDirty(path);
    redrawOverlay();
  };
  const deleteSelection = () => {
    if (!st.selection) return;
    pushUndo();
    const { x, y, w, h } = st.selection;
    bctx.clearRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    clearSelection();
    octx.clearRect(0, 0, overlay.width, overlay.height);
    markImageDirty(path);
  };
  const pasteCanvas = pasted => {
    if (!pasted) return;
    pushUndo();
    const px = st.selection ? Math.round(st.selection.x) : 0;
    const py = st.selection ? Math.round(st.selection.y) : 0;
    bctx.drawImage(pasted, px, py);
    // Make the pasted region the new selection so the user can move/edit it.
    st.selection = { x: px, y: py, w: pasted.width, h: pasted.height };
    st.tool = 'select';
    toolbar.querySelectorAll('.paint-tool').forEach(b =>
      b.classList.toggle('active', b.dataset.tool === 'select'));
    markImageDirty(path);
    redrawOverlay();
  };
  const paste = () => pasteCanvas(st.clipboard);
  const pasteBlob = async blob => {
    const bmp = await createImageBitmap(blob);
    const tmp = document.createElement('canvas');
    tmp.width = bmp.width; tmp.height = bmp.height;
    tmp.getContext('2d').drawImage(bmp, 0, 0);
    pasteCanvas(tmp);
  };

  return {
    save:            () => saveImageFile(path),
    getCanvas:       () => base,
    undo, redo,
    copy, cut, paste, pasteBlob,
    deleteSelection,
    hasSelection:    () => !!st.selection,
    zoom, zoomReset,
    snapshotDataURL: () => base.toDataURL(),
    destroy:         () => { stopAnts(); },
  };
}

function markImageDirty(path) {
  const f = state.files[path];
  if (!f) return;
  setFileDirty(path, true);
}

async function saveImageFile(path) {
  const f = state.files[path];
  if (!f || !f.paint) return;
  const canvas = f.paint.getCanvas();
  // Pick a sensible mime from the file extension.
  const ext = (path.split('.').pop() || 'png').toLowerCase();
  const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' :
               (ext === 'webp') ? 'image/webp' : 'image/png';
  const blob = await new Promise(res => canvas.toBlob(res, mime, 0.92));
  if (!blob) { alert('save failed: blob conversion'); return; }
  try {
    const r = await fetch('/api/fs/write_raw?path=' + encodeURIComponent(path), {
      method: 'POST',
      headers: { 'Content-Type': mime },
      body: blob,
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert('save failed: ' + (j.error || r.status));
      return;
    }
    setFileDirty(path, false);
    // Refresh the view <img> so it picks up the saved pixels.
    const v = f.surface.querySelector('.image-view-wrap img');
    if (v) v.src = '/api/fs/raw?path=' + encodeURIComponent(path) + '&_t=' + Date.now();
  } catch (err) {
    alert('save failed: ' + err.message);
  }
}

// ===== Vision: send an image to the AI for description ==================
async function analyzeImage(path, prompt) {
  const aiEl = pushMsg('user', '[image] ' + path);
  const resp = pushMsg('ai', 'looking at image…');
  try {
    const r = await fetch('/api/vision', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path,
        prompt: prompt || 'Describe what you see in this image. Be specific and concrete.',
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      resp.querySelector('.body').textContent = 'vision error: ' + (j.error || r.status);
      return;
    }
    resp.querySelector('.body').textContent = j.text || '(empty response)';
  } catch (err) {
    resp.querySelector('.body').textContent = 'vision error: ' + err.message;
  }
}

function activateFile(path) {
  const f = state.files[path];
  if (!f) return;
  state.activeFilePath = path;
  for (const [p, ff] of Object.entries(state.files)) {
    ff.surface.classList.toggle('active', p === path);
    ff.tab.classList.toggle('active', p === path);
  }
  // Focus the editable surface for immediate typing / Ctrl+S.
  const ta = f.surface.querySelector('textarea');
  if (ta) ta.focus();
  saveState();
}

function setFileDirty(path, dirty) {
  const f = state.files[path];
  if (!f) return;
  f.dirty = dirty;
  f.tab.classList.toggle('dirty', dirty);
}

async function saveFile(path, content) {
  try {
    const r = await fetch('/api/fs/write', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({path, content}),
    });
    if (!r.ok) {
      const j = await r.json().catch(()=>({}));
      alert('save failed: ' + (j.error || r.status));
      return;
    }
    const f = state.files[path];
    if (f) {
      f.savedContent = content;
      setFileDirty(path, false);
    }
  } catch (err) {
    alert('save failed: ' + err.message);
  }
}

function closeFile(path) {
  const f = state.files[path];
  if (!f) return;
  if (f.dirty && !confirm(`Discard unsaved changes to ${path.split('/').pop()}?`)) return;
  try { f.destroy(); } catch {}
  f.surface.remove();
  f.tab.remove();
  delete state.files[path];
  if (state.activeFilePath === path) {
    const next = Object.keys(state.files)[0];
    if (next) activateFile(next);
    else {
      state.activeFilePath = null;
      const empty = document.createElement('div');
      empty.className = 'editor-empty hint';
      empty.textContent = 'No file open. Use File → Open Folder, then click a file.';
      editorBody.appendChild(empty);
    }
  }
  saveState();
}

// Global Ctrl+S: save the currently active file.
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    const path = state.activeFilePath;
    if (!path) return;
    const f = state.files[path];
    if (!f) return;
    e.preventDefault();
    if (f.mode === 'image' && f.imgMode === 'edit') {
      saveImageFile(path);
    } else {
      saveFile(path, f.getContent());
    }
  }
});

// Image-edit keyboard shortcuts: Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) /
// Ctrl+C / Ctrl+X / Ctrl+V / Delete. Only active when an image tab is in
// edit mode. We don't intercept browser copy/cut/paste inside text inputs.
document.addEventListener('keydown', e => {
  const path = state.activeFilePath;
  if (!path) return;
  const f = state.files[path];
  if (!f || f.mode !== 'image' || f.imgMode !== 'edit' || !f.paint) return;
  // Don't hijack keys while typing into an input/textarea anywhere.
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
            t.isContentEditable)) return;
  const meta = e.ctrlKey || e.metaKey;
  if (meta && e.key.toLowerCase() === 'z' && !e.shiftKey) {
    e.preventDefault(); f.paint.undo();
  } else if (meta && (e.key.toLowerCase() === 'y' ||
                      (e.key.toLowerCase() === 'z' && e.shiftKey))) {
    e.preventDefault(); f.paint.redo();
  } else if (meta && e.key.toLowerCase() === 'c') {
    if (!f.paint.hasSelection()) return;
    e.preventDefault(); f.paint.copy();
  } else if (meta && e.key.toLowerCase() === 'x') {
    if (!f.paint.hasSelection()) return;
    e.preventDefault(); f.paint.cut();
  } else if (meta && e.key.toLowerCase() === 'v') {
    // OS-clipboard paste flows through the 'paste' event below; this only
    // fires for internal-only-clipboard fallback. preventDefault keeps the
    // browser from inserting text somewhere unhelpful.
    e.preventDefault(); f.paint.paste();
  } else if ((e.key === 'Delete' || e.key === 'Backspace') &&
             f.paint.hasSelection()) {
    e.preventDefault(); f.paint.deleteSelection();
  } else if (meta && (e.key === '+' || e.key === '=')) {
    e.preventDefault(); f.paint.zoom(+1);
  } else if (meta && e.key === '-') {
    e.preventDefault(); f.paint.zoom(-1);
  } else if (meta && e.key === '0') {
    e.preventDefault(); f.paint.zoomReset();
  }
});

// Paste an image from the OS clipboard into the active image-edit canvas.
document.addEventListener('paste', e => {
  const path = state.activeFilePath;
  if (!path) return;
  const f = state.files[path];
  if (!f || f.mode !== 'image' || f.imgMode !== 'edit' || !f.paint) return;
  const items = e.clipboardData ? e.clipboardData.items : [];
  for (const item of items) {
    if (item.type && item.type.startsWith('image/')) {
      e.preventDefault();
      const blob = item.getAsFile();
      if (blob) f.paint.pasteBlob(blob);
      return;
    }
  }
});

function createInRoot(kind) {
  if (!state.rootDir) {
    // Quiet message in the chat panel; no browser popup.
    pushMsg('ai', 'Open a folder first (File → Open Folder).');
    return;
  }
  // Remove any prior inline editor.
  filesTree.querySelector('.fs-new-inline')?.remove();
  const wrap = document.createElement('div');
  wrap.className = 'fs-new-inline';
  wrap.innerHTML =
    `<input type="text" placeholder="${kind === 'folder' ? 'new folder name…' : 'new file name…'}">`;
  filesTree.insertBefore(wrap, filesTree.firstChild);
  const input = wrap.querySelector('input');
  input.focus();

  let committed = false;
  const commit = async () => {
    if (committed) return;
    committed = true;
    const name = input.value.trim();
    wrap.remove();
    if (!name) return;
    const path = joinPath(state.rootDir, name);
    if (kind === 'folder') {
      await fetch('/api/fs/mkdir', {method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({path})});
    } else {
      await fetch('/api/fs/write', {method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({path, content:''})});
    }
    refreshFileTree();
    if (kind === 'file') openFile(path);
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { committed = true; wrap.remove(); }
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
  });
  input.addEventListener('blur', () => commit());
}
async function deleteSelected() {
  const path = state.activeFilePath;
  if (!path) { alert('No file selected'); return; }
  if (!confirm('Delete ' + path + '?')) return;
  await fetch('/api/fs/delete?path=' + encodeURIComponent(path), {method:'DELETE'});
  const f = state.files[path];
  if (f) {
    try { f.destroy(); } catch {}
    f.surface.remove();
    f.tab.remove();
    delete state.files[path];
  }
  state.activeFilePath = Object.keys(state.files)[0] || null;
  if (state.activeFilePath) activateFile(state.activeFilePath);
  else {
    const empty = document.createElement('div');
    empty.className = 'editor-empty hint';
    empty.textContent = 'No file open.';
    editorBody.appendChild(empty);
  }
  refreshFileTree();
  saveState();
}

// ---- AI chat ----------------------------------------------------------
const chatForm  = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatLog   = document.getElementById('chat-log');

// Drop an image from the file tree onto the AI pane to trigger vision
// analysis. Both the log and the input field accept the drop.
const chatPane  = document.getElementById('pane-chat');
const IMG_EXTS  = new Set(['png','jpg','jpeg','gif','webp','bmp']);
const isImagePath = p => {
  const e = (p.split('.').pop() || '').toLowerCase();
  return IMG_EXTS.has(e);
};
chatPane.addEventListener('dragover', e => {
  if (e.dataTransfer.types.includes('text/x-tool-path')) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    chatPane.classList.add('drop-target');
  }
});
chatPane.addEventListener('dragleave', e => {
  if (e.target === chatPane) chatPane.classList.remove('drop-target');
});
chatPane.addEventListener('drop', e => {
  chatPane.classList.remove('drop-target');
  const path = e.dataTransfer.getData('text/x-tool-path');
  if (!path) return;
  e.preventDefault();
  if (!isImagePath(path)) {
    pushMsg('ai', 'drop an image (png/jpg/webp/…) to analyse.');
    return;
  }
  analyzeImage(path);
});

chatForm.addEventListener('submit', async e => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = '';
  pushMsg('user', text);

  // Set up the AI message with a streaming "thinking" expander up-front.
  // Layers append into the expander as SSE events arrive; the final event
  // sets the visible headline (handler output).
  const aiEl = pushMsg('ai', '');
  const body = aiEl.querySelector('.body');
  body.innerHTML = '';
  const headlinePre = document.createElement('pre');
  headlinePre.className = 'ai-headline';
  headlinePre.textContent = 'thinking…';
  body.appendChild(headlinePre);

  const chain = document.createElement('details');
  chain.className = 'chain';
  chain.innerHTML = '<summary></summary><div class="layers"></div>';
  const summary  = chain.querySelector('summary');
  const layersEl = chain.querySelector('.layers');
  summary.textContent = 'thinking… (0 layers)';
  body.appendChild(chain);

  let layerCount = 0;
  const appendLayer = (name, content) => {
    const div = document.createElement('div');
    div.className = 'layer';
    div.innerHTML = '<div class="lab"></div><div class="payload"></div>';
    div.querySelector('.lab').textContent = name;
    div.querySelector('.payload').textContent = content;
    layersEl.appendChild(div);
    ++layerCount;
    summary.textContent = `thinking… (${layerCount} layer${layerCount === 1 ? '' : 's'})`;
    chatLog.scrollTop = chatLog.scrollHeight;
  };

  const onFinal = j => {
    summary.textContent = `thinking (${layerCount} layers)`;
    headlinePre.textContent = computeHeadline(j);
    // Tag info goes INSIDE the chain, not the visible headline.
    const tag = document.createElement('div');
    tag.className = 'layer';
    tag.innerHTML = '<div class="lab">tags</div><div class="payload"></div>';
    const act = j.act || {};
    const tags = (act.tags || []).join(',');
    tag.querySelector('.payload').textContent =
      `[act=${act.act || '?'}${act.subtype ? ' subtype=' + act.subtype : ''}` +
      `${tags ? ' tags=' + tags : ''}] [${j.expertise || '?'}]`;
    layersEl.appendChild(tag);
    if (j.handler && j.handler.kind === 'shell') refreshFileTreeIfOpen();
    chatLog.scrollTop = chatLog.scrollHeight;
  };

  try {
    const r = await fetch('/api/chat', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({message: text, cwd: state.rootDir || ''}),
    });
    if (!r.ok || !r.body) {
      const j = await r.json().catch(()=>({error: 'request failed'}));
      headlinePre.textContent = 'error: ' + (j.error || r.status);
      return;
    }
    const reader  = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let sep;
      while ((sep = buf.indexOf('\n\n')) !== -1) {
        const eventText = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        let evtName = '';
        let dataStr = '';
        for (const line of eventText.split('\n')) {
          if (line.startsWith('event: ')) evtName = line.slice(7).trim();
          else if (line.startsWith('data: ')) {
            dataStr += (dataStr ? '\n' : '') + line.slice(6);
          }
        }
        if (!evtName) continue;
        let payload;
        try { payload = JSON.parse(dataStr); } catch { continue; }
        if (evtName === 'layer')      appendLayer(payload.name, payload.content);
        else if (evtName === 'final') onFinal(payload);
        else if (evtName === 'error') {
          headlinePre.textContent = 'error: ' + (payload.error || 'unknown');
        }
      }
    }
  } catch (err) {
    headlinePre.textContent = 'network error: ' + err.message;
  }
});

function computeHeadline(j) {
  const h = j.handler || {};
  if (h.kind === 'shell') {
    const out = (h.stdout || '').trim();
    if (h.exit_code === 0) return out ? out : 'done';
    return (out ? out + '\n' : '') + '[exit ' + h.exit_code + ']';
  }
  // answer / physics_answer / chemistry_answer / future *_answer handlers
  if (h.kind && h.kind.endsWith('answer')) {
    return h.answer || '';
  }
  if (h.kind === 'statement' || h.kind === 'noted')   return h.message || '(noted)';
  return j.final || '(no handler)';
}

function pushMsg(role, body) {
  const el = document.createElement('div');
  el.className = `chat-msg ${role}`;
  el.innerHTML = `<div class="role"></div><div class="body"></div>`;
  el.querySelector('.role').textContent = role;
  el.querySelector('.body').textContent = body;
  chatLog.appendChild(el);
  chatLog.scrollTop = chatLog.scrollHeight;
  return el;
}

function renderAIResponse(msgEl, j) {
  const body = msgEl.querySelector('.body');
  body.innerHTML = '';

  // Headline: handler output, cleaned up.
  const h = j.handler || {};
  let headline = '';
  if (h.kind === 'shell') {
    const out = (h.stdout || '').trim();
    if (h.exit_code === 0) {
      headline = out ? out : 'done';
    } else {
      headline = (out ? out + '\n' : '') + '[exit ' + h.exit_code + ']';
    }
  } else if (h.kind === 'answer') {
    headline = h.answer || '';
  } else if (h.kind === 'statement' || h.kind === 'noted') {
    headline = h.message || '(noted)';
  } else {
    headline = j.final || '(no handler)';
  }
  const pre = document.createElement('pre');
  pre.style.margin = '0';
  pre.style.whiteSpace = 'pre-wrap';
  pre.textContent = headline;
  body.appendChild(pre);

  // Tag line
  const tag = document.createElement('div');
  tag.className = 'tag-line';
  const act = j.act || {};
  const tags = (act.tags || []).join(',');
  tag.textContent =
    `[act=${act.act||'?'}${act.subtype?' subtype='+act.subtype:''}${tags?' tags='+tags:''}] ` +
    `[${j.expertise || '?'}]`;
  body.appendChild(tag);

  // Collapsible "thinking" chain. Includes the shell command if applicable
  // so the user can see what the model actually ran.
  const allLayers = (j.layers || []).slice();
  if (h.kind === 'shell' && h.command) {
    allLayers.push({name: 'shell command', content: h.command});
  }
  if (allLayers.length) {
    const det = document.createElement('details');
    det.className = 'chain';
    const sum = document.createElement('summary');
    sum.textContent = `thinking (${allLayers.length} layers)`;
    det.appendChild(sum);
    const wrap = document.createElement('div');
    wrap.className = 'layers';
    for (const l of allLayers) {
      const div = document.createElement('div');
      div.className = 'layer';
      div.innerHTML = `<div class="lab"></div><div class="payload"></div>`;
      div.querySelector('.lab').textContent = l.name;
      div.querySelector('.payload').textContent = l.content;
      wrap.appendChild(div);
    }
    det.appendChild(wrap);
    body.appendChild(det);
  }
  chatLog.scrollTop = chatLog.scrollHeight;
}

// ---- terminals: tabs + VS-Code-style single-pane (no separate input) --
const tabsList  = document.getElementById('term-tabs-list');
const termStack = document.getElementById('term-stack');
document.getElementById('term-new').addEventListener('click', () => newTerminal());

function newTerminal() {
  const id = 'T' + (state.nextTermId++);
  newTerminalAtCwd(id, state.rootDir || '~');
  activateTerminal(id);
  saveState();
}

function activateTerminal(id) {
  state.activeTerm = id;
  for (const el of tabsList.children) el.classList.toggle('active', el.dataset.id === id);
  for (const el of termStack.children) el.classList.toggle('active', el.dataset.id === id);
  const scr = termStack.querySelector(`.term-instance[data-id="${id}"] .term-screen`);
  if (scr) { scr.focus(); scrollToBottom(scr); }
}

function closeTerminal(id) {
  delete state.terminals[id];
  tabsList.querySelector(`.term-tab[data-id="${id}"]`)?.remove();
  termStack.querySelector(`.term-instance[data-id="${id}"]`)?.remove();
  if (state.activeTerm === id) {
    const next = Object.keys(state.terminals)[0];
    if (next) activateTerminal(next);
    else state.activeTerm = null;
  }
}

function scrollToBottom(el) {
  el.scrollTop = el.scrollHeight;
}

// Render the active-input "prompt line" at the bottom of a screen.
function renderPromptLine(scr, cwd, current) {
  let promptLine = scr.querySelector('.term-prompt-line');
  if (!promptLine) {
    promptLine = document.createElement('div');
    promptLine.className = 'term-prompt-line';
    promptLine.innerHTML =
      `<span class="term-prompt"></span><span class="term-cmd"></span><span class="term-cursor"></span>`;
    scr.appendChild(promptLine);
  }
  promptLine.querySelector('.term-prompt').textContent = shortCwd(cwd) + '$ ';
  promptLine.querySelector('.term-cmd').textContent    = current;
  scrollToBottom(scr);
}

function shortCwd(cwd) {
  if (!cwd) return '~';
  const home = '/home/';
  if (cwd === '~') return '~';
  // Heuristic: replace /home/<user>/ with ~/
  const m = cwd.match(/^\/home\/[^/]+(.*)$/);
  if (m) return '~' + m[1];
  return cwd;
}

async function submitTerminalCommand(id, raw) {
  const t = state.terminals[id];
  if (!t) return;
  const scr = termStack.querySelector(`.term-instance[data-id="${id}"] .term-screen`);
  const promptLine = scr.querySelector('.term-prompt-line');

  // Freeze the prompt line as part of transcript.
  const frozen = document.createElement('div');
  frozen.className = 'term-entry';
  frozen.innerHTML = `<div class="frozen-line"><span class="term-prompt"></span><span class="term-cmd"></span></div>` +
                     `<pre class="term-out-block"></pre><div class="term-exit"></div>`;
  frozen.querySelector('.term-prompt').textContent = shortCwd(t.cwd) + '$ ';
  frozen.querySelector('.term-cmd').textContent    = raw;
  scr.insertBefore(frozen, promptLine);

  // Empty command: just new prompt line.
  if (!raw.trim()) {
    t.input = '';
    renderPromptLine(scr, t.cwd, '');
    return;
  }

  // Client-side `clear` so we don't emit raw ANSI escape codes.
  if (raw.trim() === 'clear') {
    frozen.remove();           // don't show the issued `clear`
    scr.innerHTML = '';
    t.input = '';              // ← critical: reset input buffer
    renderPromptLine(scr, t.cwd, '');
    return;
  }

  // Handle cd client-side so cwd survives.
  const cdMatch = raw.trim().match(/^cd(?:\s+(.+))?$/);
  if (cdMatch) {
    const dest = (cdMatch[1] || '~').trim();
    try {
      const r = await fetch('/api/terminal/exec', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({command: `cd ${dest} && pwd`, cwd: t.cwd}),
      });
      const j = await r.json();
      if (j.exit_code === 0) {
        t.cwd = (j.stdout || '').trim();
      } else {
        frozen.querySelector('.term-out-block').textContent = (j.stdout || '').trim();
        const ex = frozen.querySelector('.term-exit');
        ex.textContent = '[exit ' + j.exit_code + ']';
        ex.classList.add('fail');
      }
    } catch (err) {
      frozen.querySelector('.term-out-block').textContent = 'network error: ' + err.message;
    }
    t.input = '';
    renderPromptLine(scr, t.cwd, '');
    saveState();
    return;
  }

  // Normal exec.
  try {
    const r = await fetch('/api/terminal/exec', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({command: raw, cwd: t.cwd}),
    });
    const j = await r.json();
    const out = (j.stdout || '').replace(/\n+$/, '');
    if (out) frozen.querySelector('.term-out-block').textContent = out;
    if (j.exit_code !== 0) {
      const ex = frozen.querySelector('.term-exit');
      ex.textContent = '[exit ' + j.exit_code + ']';
      ex.classList.add('fail');
    }
  } catch (err) {
    frozen.querySelector('.term-out-block').textContent = 'network error: ' + err.message;
  }
  t.input = '';
  renderPromptLine(scr, t.cwd, '');
  saveState();
}

// Override newTerminalAtCwd with the screen-driven implementation.
function newTerminalAtCwd(id, cwd) {
  state.terminals[id] = { cwd, input: '', history: [], hist_idx: -1 };

  // tab
  const tab = document.createElement('div');
  tab.className = 'term-tab';
  tab.dataset.id = id;
  tab.innerHTML = `<span class="label"></span><span class="x" title="Close">×</span>`;
  tab.querySelector('.label').textContent = id;
  tab.addEventListener('click', e => {
    if (e.target.classList.contains('x')) return;
    activateTerminal(id);
  });
  tab.querySelector('.x').addEventListener('click', e => {
    e.stopPropagation();
    closeTerminal(id);
    saveState();
  });
  tabsList.appendChild(tab);

  // body: single keystroke-driven screen
  const body = document.createElement('div');
  body.className = 'term-instance';
  body.dataset.id = id;
  body.innerHTML = `<div class="term-screen" tabindex="0"></div>`;
  termStack.appendChild(body);

  const scr = body.querySelector('.term-screen');
  scr.addEventListener('focus', () => scr.classList.add('focused'));
  scr.addEventListener('blur',  () => scr.classList.remove('focused'));
  scr.addEventListener('mousedown', () => scr.focus());

  scr.addEventListener('keydown', e => {
    const t = state.terminals[id];
    if (!t) return;
    // Let the browser handle Ctrl+C (copy), Ctrl+V (paste), Ctrl+X (cut),
    // Ctrl+A (select all). Standard browser shortcuts win.
    if ((e.ctrlKey || e.metaKey) && 'cvxa'.includes(e.key.toLowerCase())) {
      return;  // do NOT preventDefault; let browser do its thing
    }
    if (e.ctrlKey && e.key === 'l') {
      // Ctrl-L clears the screen.
      e.preventDefault();
      scr.innerHTML = '';
      renderPromptLine(scr, t.cwd, t.input);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const raw = t.input;
      if (raw.trim()) {
        t.history.push(raw);
        t.hist_idx = t.history.length;
      }
      submitTerminalCommand(id, raw);
      return;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      t.input = t.input.slice(0, -1);
      renderPromptLine(scr, t.cwd, t.input);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (t.history.length === 0) return;
      t.hist_idx = Math.max(0, t.hist_idx - 1);
      t.input = t.history[t.hist_idx] || '';
      renderPromptLine(scr, t.cwd, t.input);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (t.history.length === 0) return;
      t.hist_idx = Math.min(t.history.length, t.hist_idx + 1);
      t.input = t.history[t.hist_idx] || '';
      renderPromptLine(scr, t.cwd, t.input);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      // No completion engine yet; just insert two spaces.
      t.input += '  ';
      renderPromptLine(scr, t.cwd, t.input);
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      t.input += e.key;
      renderPromptLine(scr, t.cwd, t.input);
      return;
    }
  });

  // Paste support.
  scr.addEventListener('paste', e => {
    e.preventDefault();
    const t = state.terminals[id];
    if (!t) return;
    const text = (e.clipboardData || window.clipboardData).getData('text');
    // Split on newlines: each line is a separate command (executed in turn).
    const lines = text.split(/\r?\n/);
    if (lines.length === 1) {
      t.input += lines[0];
      renderPromptLine(scr, t.cwd, t.input);
      return;
    }
    (async () => {
      t.input += lines[0];
      renderPromptLine(scr, t.cwd, t.input);
      await submitTerminalCommand(id, t.input);
      for (let i = 1; i < lines.length - 1; i++) {
        t.input = lines[i];
        renderPromptLine(scr, t.cwd, t.input);
        await submitTerminalCommand(id, t.input);
      }
      if (lines.length > 1) {
        t.input = lines[lines.length - 1];
        renderPromptLine(scr, t.cwd, t.input);
      }
    })();
  });

  // initial prompt
  renderPromptLine(scr, cwd, '');
}

// ---- state persistence (per-session) ----------------------------------
// Two-tier persistence: sessionStorage is a fast-paint cache (per tab),
// the server is authoritative (survives close-browser, restart-machine,
// and is the source the picker reads). Session id is in the URL fragment.
const STATE_KEY_BASE = 'tool_state_v1';
const stateKey = () =>
  currentSessionId ? STATE_KEY_BASE + ':' + currentSessionId : STATE_KEY_BASE;

let serverSaveTimer = null;
function scheduleServerSave() {
  if (serverSaveTimer) clearTimeout(serverSaveTimer);
  serverSaveTimer = setTimeout(syncStateToServer, 500);
}
async function syncStateToServer() {
  if (!currentSessionId) return;
  const blob = JSON.parse(sessionStorage.getItem(stateKey()) || '{}');
  try {
    await fetch('/api/sessions/' + currentSessionId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ui: blob }),
    });
  } catch {}
}

function saveState() {
  const root = document.documentElement;
  const s = {
    rootDir: state.rootDir,
    openFiles: Object.keys(state.files || {}),
    activeFilePath: state.activeFilePath,
    panes: {
      filesHidden: document.getElementById('pane-files').classList.contains('collapsed'),
      chatHidden:  document.getElementById('pane-chat').classList.contains('collapsed'),
      termHidden:  document.getElementById('terminal-bar').classList.contains('collapsed'),
      filesW: getComputedStyle(root).getPropertyValue('--files-w').trim(),
      chatW:  getComputedStyle(root).getPropertyValue('--chat-w').trim(),
      termH:  getComputedStyle(root).getPropertyValue('--term-h').trim(),
    },
    terminals:  Object.entries(state.terminals).map(([id, t]) => ({id, cwd: t.cwd})),
    activeTerm: state.activeTerm,
    nextTermId: state.nextTermId,
  };
  try { sessionStorage.setItem(stateKey(), JSON.stringify(s)); } catch {}
  scheduleServerSave();
}

// Replay one server-stored chat row (role + text) into the chat log
// — used by the boot path so refresh restores the visible conversation.
function replayChatMessage(role, text) {
  if (!text) return;
  pushMsg(role === 'user' ? 'user' : 'ai', text);
}

async function restoreState() {
  // 1. Fast paint from sessionStorage cache (if any).
  let s = null;
  try { s = JSON.parse(sessionStorage.getItem(stateKey()) || 'null'); } catch {}

  // 2. Pull authoritative state from the server.
  let serverPayload = null;
  if (currentSessionId) {
    try {
      const r = await fetch('/api/sessions/' + currentSessionId);
      if (r.ok) serverPayload = await r.json();
    } catch {}
  }
  if (serverPayload && serverPayload.ui && Object.keys(serverPayload.ui).length) {
    s = serverPayload.ui;
    try { sessionStorage.setItem(stateKey(), JSON.stringify(s)); } catch {}
  }

  // 3. Render the chat log from the server (so refresh shows the convo).
  if (serverPayload && Array.isArray(serverPayload.chat)) {
    for (const m of serverPayload.chat) replayChatMessage(m.role, m.text);
  }

  if (!s) {
    // Fresh session: open one terminal so the bar isn't empty.
    newTerminal();
    return;
  }

  // pane sizes / collapse state
  if (s.panes) {
    if (s.panes.filesW) document.documentElement.style.setProperty('--files-w', s.panes.filesW);
    if (s.panes.chatW)  document.documentElement.style.setProperty('--chat-w',  s.panes.chatW);
    if (s.panes.termH)  document.documentElement.style.setProperty('--term-h',  s.panes.termH);
    for (const [id, hide, key] of [
      ['pane-files',   s.panes.filesHidden, 'pane-files'],
      ['pane-chat',    s.panes.chatHidden,  'pane-chat'],
      // Do NOT restore termHidden: always show the terminal on load so the
      // user can't end up with a perpetually-hidden terminal they forgot
      // about. (They can still toggle it off this session via the ⌨ icon.)
    ]) {
      if (!hide) continue;
      const target = document.getElementById(id);
      const btn = document.querySelector(`.pane-toggle[data-toggle="${key}"]`);
      if (target) target.classList.add('collapsed');
      if (btn) btn.classList.remove('active');
      if (id === 'pane-files')
        document.querySelector('.resizer[data-target="pane-files"]')?.classList.add('collapsed');
      if (id === 'pane-chat')
        document.querySelector('.resizer[data-target="pane-chat"]')?.classList.add('collapsed');
      if (id === 'terminal-bar') {
        document.getElementById('resizer-terminal')?.classList.add('collapsed');
        document.body.style.gridTemplateRows = '28px 1fr 0 0';
      }
    }
    updateLayoutColumns();
    if (!s.panes.termHidden && s.panes.termH) {
      document.body.style.gridTemplateRows = `28px 1fr 4px ${s.panes.termH}`;
    }
  }

  // restore terminals BEFORE file/folder so cwd is consistent
  if (Array.isArray(s.terminals) && s.terminals.length) {
    state.nextTermId = s.nextTermId || 1;
    for (const t of s.terminals) {
      newTerminalAtCwd(t.id, t.cwd);
    }
    activateTerminal(s.activeTerm || s.terminals[0].id);
  } else {
    newTerminal();
  }

  // root folder + open files (multi-tab)
  if (s.rootDir) {
    commitOpenFolder(s.rootDir);
    if (Array.isArray(s.openFiles)) {
      for (const path of s.openFiles) {
        await openFile(path);
      }
      if (s.activeFilePath && state.files[s.activeFilePath]) {
        activateFile(s.activeFilePath);
      }
    }
  }
}

// ---- hooks: save state on relevant events -----------------------------
const origCommitOpenFolder = commitOpenFolder;
commitOpenFolder = function(p) { origCommitOpenFolder(p); saveState(); };
const origOpenFile = openFile;
openFile = async function(p) { await origOpenFile(p); saveState(); };
const origActivate = activateTerminal;
activateTerminal = function(id) { origActivate(id); saveState(); };
const origClose = closeTerminal;
closeTerminal = function(id) { origClose(id); saveState(); };
const origNew = newTerminal;
newTerminal = function() { origNew(); saveState(); };
// (the actual terminal-submit wrapper lives further down, near the file-tree
// refresh hook — that's where cd-driven cwd changes get a saveState.)
// Pane toggles
paneToggles.forEach(btn => btn.addEventListener('click', () => saveState()));
// Resize: debounce save
let resizeSaveT = null;
['mousemove','mouseup'].forEach(ev => document.addEventListener(ev, () => {
  if (resizeSaveT) clearTimeout(resizeSaveT);
  resizeSaveT = setTimeout(saveState, 250);
}));

// Warn on close if any open file has unsaved changes.
window.addEventListener('beforeunload', e => {
  for (const f of Object.values(state.files || {})) {
    if (f.dirty) { e.preventDefault(); e.returnValue = ''; return; }
  }
});

// ---- file tree auto-refresh after any shell/term action --------------
function refreshFileTreeIfOpen() { if (state.rootDir) refreshFileTree(); }

// Poll for external file changes. Recurses into every currently-expanded
// subfolder so changes inside open folders also trigger refresh. Preserves
// expansion state across the re-render so the user's open folders survive.
let __lastTreeHash = '';
async function snapshotTree(rootPath, expanded) {
  // Returns a hash string covering root + all expanded subfolders.
  const stack = [rootPath];
  const parts = [];
  while (stack.length) {
    const p = stack.shift();
    const d = await fsList(p);
    if (!d) continue;
    parts.push(p + ':' + d.entries.map(e => e.name + (e.is_dir ? '/' : '')).join(','));
    for (const e of d.entries) {
      if (e.is_dir && expanded.has(joinPath(p, e.name))) {
        stack.push(joinPath(p, e.name));
      }
    }
  }
  return parts.join('|');
}

function getExpandedPaths() {
  const s = new Set();
  filesTree.querySelectorAll('.fs-dir').forEach(node => {
    const kids = node.querySelector('.fs-children');
    if (kids && !kids.classList.contains('hidden')) s.add(node.dataset.path);
  });
  return s;
}

async function reExpand(expanded) {
  for (const path of expanded) {
    const node = filesTree.querySelector(`.fs-dir[data-path="${CSS.escape(path)}"]`);
    if (!node) continue;
    const kids = node.querySelector('.fs-children');
    if (!kids) continue;
    kids.classList.remove('hidden');
    if (kids.children.length === 0) {
      const sub = await fsList(path);
      if (sub) renderEntries(kids, sub.path, sub.entries);
    }
  }
}

async function pollFileTree() {
  if (!state.rootDir) return;
  const expanded = getExpandedPaths();
  const h = await snapshotTree(state.rootDir, expanded);
  if (h === __lastTreeHash) return;
  __lastTreeHash = h;
  const data = await fsList(state.rootDir);
  if (!data) return;
  filesTree.innerHTML = '';
  renderEntries(filesTree, data.path, data.entries);
  await reExpand(expanded);
}
setInterval(pollFileTree, 1500);

// Hook terminal submit + chat shell to refresh immediately too.
const _origSubmit = submitTerminalCommand;
submitTerminalCommand = async function(id, raw) {
  await _origSubmit(id, raw);
  refreshFileTreeIfOpen();
  saveState();                  // cwd may have changed via cd
};
const _origRender = renderAIResponse;
renderAIResponse = function(el, j) {
  _origRender(el, j);
  if (j.handler && j.handler.kind === 'shell') refreshFileTreeIfOpen();
};

// Boot — resolve session first, then restore state.
bootSession();

async function bootSession() {
  if (currentSessionId) {
    // Verify the session still exists; otherwise fall through to picker.
    try {
      const r = await fetch('/api/sessions/' + currentSessionId);
      if (r.ok) { restoreState(); return; }
    } catch {}
    currentSessionId = null;
    history.replaceState(null, '', location.pathname);
  }
  let sessions = [];
  try {
    const r = await fetch('/api/sessions');
    if (r.ok) sessions = (await r.json()).sessions || [];
  } catch {}
  if (sessions.length === 0) {
    const m = await createSessionOnServer({});
    if (m) { setSessionInUrl(m.id); restoreState(); return; }
    // server unreachable — soldier on with a transient id; sync will retry.
    setSessionInUrl('00000000-0000-0000-0000-000000000000');
    restoreState();
    return;
  }
  openSessionPicker({ allowClose: false, sessions });
}

// ---- utils ------------------------------------------------------------
function escapeHTML(s) {
  return s.replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
