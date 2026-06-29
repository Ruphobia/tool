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
    case 'open-folder':   openFolderPicker(); break;
    case 'new-file':      createInRoot('file');   break;
    case 'new-folder':    createInRoot('folder'); break;
    case 'delete':        deleteSelected();   break;
    case 'quit':          fetch('/api/quit', {method:'POST'}); break;
    case 'clear-context': clearContext(); break;
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
    await fetch('/api/context/clear', { method: 'POST' });
  } catch {}
  chatLog.innerHTML = '';
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
function commitOpenFolder(path) {
  state.rootDir = path;
  document.getElementById('files-root').textContent = path;
  // open terminals reset to new project root; update their prompt lines too.
  for (const [id, t] of Object.entries(state.terminals)) {
    t.cwd = path;
    const scr = termStack.querySelector(`.term-instance[data-id="${id}"] .term-screen`);
    if (scr) renderPromptLine(scr, t.cwd, t.input || '');
  }
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
    try {
      const editor = new toastui.Editor({
        el: host,
        initialValue: j.content,
        previewStyle: 'tab',
        initialEditType: 'wysiwyg',
        theme: 'dark',
        height: '100%',
        usageStatistics: false,
        hideModeSwitch: false,
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
    } catch (err) {
      // Toast UI blew up. Fall back to a plain textarea showing the source
      // so the user can at least see + edit the markdown.
      console.error('Toast UI editor failed:', err);
      host.remove();
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

  // Build tab
  const tab = document.createElement('div');
  tab.className = 'editor-tab';
  tab.dataset.path = path;
  tab.innerHTML = `<span class="dirty">●</span><span class="label"></span><span class="x" title="Close">×</span>`;
  tab.querySelector('.label').textContent = path.split('/').pop();
  tab.title = path;
  tab.addEventListener('click', e => {
    if (e.target.classList.contains('x')) return;
    activateFile(path);
  });
  tab.querySelector('.x').addEventListener('click', e => {
    e.stopPropagation();
    closeFile(path);
  });
  editorTabs.appendChild(tab);

  // Finalize the state entry — overwrite the early placeholder we wrote
  // before editor construction with the real getContent / destroy + tab.
  state.files[path].tab        = tab;
  state.files[path].getContent = getContent;
  state.files[path].destroy    = destroy;

  activateFile(path);
  saveState();
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
    saveFile(path, f.getContent());
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
  if (h.kind === 'answer' || h.kind === 'physics_answer') {
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

// Warn on close if any open file has unsaved changes.
window.addEventListener('beforeunload', e => {
  for (const f of Object.values(state.files || {})) {
    if (f.dirty) { e.preventDefault(); e.returnValue = ''; return; }
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
