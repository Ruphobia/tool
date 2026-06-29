// tool web UI - vanilla JS, no framework.

const state = {
  rootDir: null,
  openFile: null,
  pickerCurrent: null,
  terminals: {},      // id -> {cwd, log[]}
  activeTerm: null,
  nextTermId: 1,
};

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
    case 'open-folder': openFolderPicker(); break;
    case 'new-file':    createInRoot('file');   break;
    case 'new-folder':  createInRoot('folder'); break;
    case 'delete':      deleteSelected();   break;
    case 'quit':        fetch('/api/quit', {method:'POST'}); break;
  }
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
    else li.addEventListener('dblclick', () => loadPickerPath(joinPath(data.path, e.name)));
    pickerList.appendChild(li);
  }
}
function joinPath(base, name) {
  return base.endsWith('/') ? base + name : base + '/' + name;
}
function commitOpenFolder(path) {
  state.rootDir = path;
  document.getElementById('files-root').textContent = path;
  // open terminals reset to new project root
  for (const t of Object.values(state.terminals)) t.cwd = path;
  renderActiveTerminalCwd();
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
    }
    into.appendChild(node);
  }
}
const editorBody  = document.getElementById('editor-body');
const editorTitle = document.getElementById('editor-title');

// File extension -> editor mode.
//   prose     : textarea with spellcheck on (text-like)
//   code      : textarea, monospace, no spellcheck (source files)
//   binary    : read-only message
const EDITOR_MODES = {
  markdown: new Set(['md','markdown']),
  prose:    new Set(['txt','rst','text']),
  code:     new Set(['c','cc','cpp','cxx','h','hpp','hxx',
                     'js','mjs','ts','tsx','jsx','html','htm','css','json',
                     'py','sh','bash','zsh','rb','go','rs','java','kt',
                     'lua','pl','php','sql','yml','yaml','toml','ini','cfg',
                     'xml','svg','log','cmake','make','makefile','dockerfile']),
};

function detectMode(path) {
  const fname = path.split('/').pop().toLowerCase();
  if (fname === 'makefile' || fname === 'dockerfile' || fname === 'cmakelists.txt') return 'code';
  const ext = fname.includes('.') ? fname.split('.').pop() : '';
  if (EDITOR_MODES.markdown.has(ext)) return 'markdown';
  if (EDITOR_MODES.prose.has(ext))    return 'prose';
  if (EDITOR_MODES.code.has(ext))     return 'code';
  return 'unknown';
}

// Held while a Toast UI Editor is mounted; null otherwise. Used by
// saveCurrentFile() so it can pull the markdown content via getMarkdown().
let mdEditor = null;

async function openFile(path) {
  const r = await fetch('/api/fs/read?path=' + encodeURIComponent(path));
  if (!r.ok) {
    editorBody.innerHTML = '';
    const w = document.createElement('div');
    w.className = 'editor-readonly';
    w.textContent = 'cannot read ' + path;
    editorBody.appendChild(w);
    return;
  }
  const j = await r.json();
  state.openFile     = path;
  state.savedContent = j.content;
  state.dirty        = false;
  updateEditorTitle();

  // Tear down any previous markdown editor before swapping.
  if (mdEditor) { try { mdEditor.destroy(); } catch {} mdEditor = null; }
  editorBody.innerHTML = '';
  const mode = detectMode(path);
  if (mode === 'markdown' && typeof toastui !== 'undefined') {
    const host = document.createElement('div');
    host.className = 'md-editor-host';
    editorBody.appendChild(host);
    mdEditor = new toastui.Editor({
      el: host,
      initialValue: j.content,
      previewStyle: 'tab',           // tabbed Markdown / WYSIWYG view
      initialEditType: 'wysiwyg',
      theme: 'dark',
      height: '100%',
      usageStatistics: false,
      autofocus: true,
      hideModeSwitch: false,
      toolbarItems: [
        ['heading','bold','italic','strike'],
        ['hr','quote'],
        ['ul','ol','task','indent','outdent'],
        ['table','link','image'],
        ['code','codeblock'],
      ],
    });
    mdEditor.on('change', () => {
      const v = mdEditor.getMarkdown();
      state.dirty = v !== state.savedContent;
      updateEditorTitle();
    });
    // Ctrl+S inside the editor's iframe-rendered surface still bubbles to
    // document, which our global handler catches.
    return;
  }
  if (mode === 'prose' || mode === 'code') {
    const ta = document.createElement('textarea');
    ta.className = 'editor-textarea' + (mode === 'prose' ? ' prose' : '');
    ta.spellcheck = (mode === 'prose');
    ta.value = j.content;
    ta.addEventListener('input', () => {
      state.dirty = ta.value !== state.savedContent;
      updateEditorTitle();
    });
    ta.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveCurrentFile(ta.value);
      }
    });
    editorBody.appendChild(ta);
    ta.focus();
  } else {
    const wrap = document.createElement('div');
    wrap.className = 'editor-readonly';
    const pre = document.createElement('pre');
    pre.textContent = j.content;
    wrap.appendChild(pre);
    editorBody.appendChild(wrap);
  }
}

function updateEditorTitle() {
  editorTitle.innerHTML = '';
  if (state.openFile && state.dirty) {
    const dot = document.createElement('span');
    dot.className = 'dirty-dot';
    dot.textContent = '●';
    editorTitle.appendChild(dot);
  }
  editorTitle.appendChild(
    document.createTextNode(state.openFile || 'Editor'));
}

async function saveCurrentFile(content) {
  if (!state.openFile) return;
  try {
    const r = await fetch('/api/fs/write', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({path: state.openFile, content}),
    });
    if (!r.ok) {
      const j = await r.json().catch(()=>({}));
      alert('save failed: ' + (j.error || r.status));
      return;
    }
    state.savedContent = content;
    state.dirty        = false;
    updateEditorTitle();
  } catch (err) {
    alert('save failed: ' + err.message);
  }
}

// Global Ctrl+S: save active editor (textarea OR Toast UI Markdown editor).
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    if (mdEditor) {
      e.preventDefault();
      saveCurrentFile(mdEditor.getMarkdown());
      return;
    }
    const ta = editorBody.querySelector('textarea');
    if (ta) { e.preventDefault(); saveCurrentFile(ta.value); }
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
  if (!state.openFile) { alert('No file selected'); return; }
  if (!confirm('Delete ' + state.openFile + '?')) return;
  await fetch('/api/fs/delete?path=' + encodeURIComponent(state.openFile), {method:'DELETE'});
  state.openFile = null;
  editorBody.innerHTML = '<em class="hint">No file selected</em>';
  refreshFileTree();
}

// ---- AI chat ----------------------------------------------------------
const chatForm  = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatLog   = document.getElementById('chat-log');

chatForm.addEventListener('submit', async e => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = '';
  pushMsg('user', text);
  const aiEl = pushMsg('ai', 'thinking…');
  try {
    const r = await fetch('/api/chat', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({message: text}),
    });
    if (!r.ok) {
      const j = await r.json().catch(()=>({error: 'request failed'}));
      aiEl.querySelector('.body').textContent = j.error || 'error';
      return;
    }
    const j = await r.json();
    renderAIResponse(aiEl, j);
  } catch (err) {
    aiEl.querySelector('.body').textContent = 'network error: ' + err.message;
  }
});

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
  newTerminalAtCwd('T' + (state.nextTermId++), state.rootDir || '~');
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
    if (e.ctrlKey && e.key === 'c') {
      // Ctrl-C clears the current input (no signal — no PTY)
      e.preventDefault();
      const old = t.input;
      t.input = '';
      // Freeze the abandoned line as visible feedback.
      const frozen = document.createElement('div');
      frozen.className = 'term-entry';
      frozen.innerHTML = `<div class="frozen-line"><span class="term-prompt"></span><span class="term-cmd"></span><span class="ctrlc">^C</span></div>`;
      frozen.querySelector('.term-prompt').textContent = shortCwd(t.cwd) + '$ ';
      frozen.querySelector('.term-cmd').textContent    = old;
      const promptLine = scr.querySelector('.term-prompt-line');
      scr.insertBefore(frozen, promptLine);
      renderPromptLine(scr, t.cwd, '');
      return;
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

// ---- state persistence (per-tab via sessionStorage) -------------------
const STATE_KEY = 'tool_state_v1';

function saveState() {
  const root = document.documentElement;
  const s = {
    rootDir: state.rootDir,
    openFile: state.openFile,
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
  try { sessionStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch {}
}

async function restoreState() {
  let s = null;
  try { s = JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null'); } catch {}
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
      ['terminal-bar', s.panes.termHidden,  'terminal-bar'],
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

  // root folder + open file
  if (s.rootDir) {
    commitOpenFolder(s.rootDir);
    if (s.openFile) {
      await openFile(s.openFile);
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
const origRunTerm = runTerminalCommand;
runTerminalCommand = async function(id, cmd) {
  await origRunTerm(id, cmd);
  saveState();   // cwd may have changed via cd
};
// Pane toggles
paneToggles.forEach(btn => btn.addEventListener('click', () => saveState()));
// Resize: debounce save
let resizeSaveT = null;
['mousemove','mouseup'].forEach(ev => document.addEventListener(ev, () => {
  if (resizeSaveT) clearTimeout(resizeSaveT);
  resizeSaveT = setTimeout(saveState, 250);
}));

// Warn on close if there are unsaved editor changes.
window.addEventListener('beforeunload', e => {
  if (state.dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ---- file tree auto-refresh after any shell/term action --------------
function refreshFileTreeIfOpen() { if (state.rootDir) refreshFileTree(); }

// Cheap fallback poll for external file changes.
let __lastTreeHash = '';
async function pollFileTree() {
  if (!state.rootDir) return;
  const data = await fsList(state.rootDir);
  if (!data) return;
  const h = data.entries.map(e => e.name + (e.is_dir ? '/' : '')).join('|');
  if (h !== __lastTreeHash) {
    __lastTreeHash = h;
    filesTree.innerHTML = '';
    renderEntries(filesTree, data.path, data.entries);
  }
}
setInterval(pollFileTree, 4000);

// Hook terminal submit + chat shell to refresh immediately too.
const _origSubmit = submitTerminalCommand;
submitTerminalCommand = async function(id, raw) {
  await _origSubmit(id, raw);
  refreshFileTreeIfOpen();
};
const _origRender = renderAIResponse;
renderAIResponse = function(el, j) {
  _origRender(el, j);
  if (j.handler && j.handler.kind === 'shell') refreshFileTreeIfOpen();
};

// Boot
restoreState();

// ---- utils ------------------------------------------------------------
function escapeHTML(s) {
  return s.replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
