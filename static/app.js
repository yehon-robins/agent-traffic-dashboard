/* Agent Traffic dashboard. Vanilla JS, no dependencies (D2). */
'use strict';

// ------------------------------------------------------------------ kinds: one color, icon, label each
const KINDS = {
  // Symbols present in ordinary text fonts (no emoji font needed); U+FE0E asks for text presentation.
  system:      { icon: '⚙\uFE0E', label: 'System' },
  tools:       { icon: '☰', label: 'Tools' },
  user:        { icon: '✎', label: 'User' },
  assistant:   { icon: '✦', label: 'Assistant' },
  tool_call:   { icon: '⚒\uFE0E', label: 'Tool call' },
  tool_result: { icon: '↩\uFE0E', label: 'Tool result' },
  thinking:    { icon: '∴', label: 'Thinking' },
  error:       { icon: '⚠\uFE0E', label: 'Error' },
};
const CODE_KEYS = new Set(['command', 'cmd', 'code', 'script', 'patch', 'diff', 'new_string', 'old_string',
  'file_text', 'content', 'sql', 'input', 'new_source', 'old_str', 'new_str']);
const LONG_LINES = 20, LONG_CHARS = 2000;

// ------------------------------------------------------------------ state
const S = {
  ex: new Map(),          // id -> summary
  rows: new Map(),        // id -> row element
  sel: null,
  detail: null,           // full record of the selected exchange
  detailCache: new Map(),
  tab: 'overview',
  f: { session: '', lane: '', model: '', tools: [], errors: false, other: false, q: '', scope: '', hide: [] },
  searchIds: null,
  paused: false,
  queued: [],
  newCount: 0,
  info: null,
  connected: false,
};

// ------------------------------------------------------------------ tiny DOM helper
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ formatting
const fmtK = (n) => n == null ? '–' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M'
  : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(n);
const fmtMs = (ms) => ms == null ? '' : ms < 1000 ? ms + 'ms' : ms < 60000 ? (ms / 1000).toFixed(1) + 's'
  : Math.floor(ms / 60000) + 'm' + String(Math.round(ms % 60000 / 1000)).padStart(2, '0') + 's';
const fmtCost = (c) => c == null ? '' : '$' + (c >= 10 ? c.toFixed(1) : c >= 0.995 ? c.toFixed(2) : c.toFixed(3));
const fmtTime = (t) => t ? new Date(t * 1000).toLocaleTimeString([], { hour12: false }) : '';
const fmtWall = (s) => s < 60 ? Math.round(s) + 's' : s < 3600 ? Math.round(s / 60) + 'm' : (s / 3600).toFixed(1) + 'h';
function rel(t) {
  const d = Date.now() / 1000 - t;
  if (d < 60) return Math.round(d) + 's ago';
  if (d < 3600) return Math.round(d / 60) + 'm ago';
  if (d < 86400) return (d / 3600).toFixed(1) + 'h ago';
  return Math.round(d / 86400) + 'd ago';
}
const timeEl = (t) => h('time', { 'data-t': t, text: fmtTime(t) });
const sizeText = (chars) => `${fmtK(chars)} chars · ~${fmtK(Math.round(chars / 4))} tok`;
const totalIn = (u) => (u.input || 0) + (u.cache_read || 0) + (u.cache_write || 0);
const isErr = (s) => s.anomalies.some((a) => a.level === 'error');
const isWarn = (s) => s.anomalies.length > 0;

function kindBadge(kind, mini) {
  const k = KINDS[kind] || { icon: '•', label: kind };
  return h('span', { class: `kb k-${kind}${mini ? ' mini' : ''}`, title: k.label },
    h('i', { 'aria-hidden': 'true' }, k.icon), mini ? null : k.label);
}

document.addEventListener('mouseover', (e) => {
  const t = e.target.closest && e.target.closest('time[data-t]');
  if (t) t.title = new Date(t.dataset.t * 1000).toLocaleString() + ' · ' + rel(+t.dataset.t);
});

// ------------------------------------------------------------------ generic content views
function copyBtn(get) {
  return h('button', {
    class: 'btn tiny', title: 'copy', onclick: (e) => {
      e.preventDefault(); e.stopPropagation();
      const text = typeof get === 'function' ? get() : get;
      const done = () => { e.target.textContent = 'copied'; setTimeout(() => (e.target.textContent = 'copy'), 900); };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
      else fallbackCopy(text, done);
    },
  }, 'copy');
}
function fallbackCopy(text, done) {
  const ta = h('textarea', { style: 'position:fixed;left:-9999px' }); ta.value = text;
  document.body.append(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch (_) { /* ignore */ }
  ta.remove();
}

/* Long text collapses to a preview with "show all (N lines)". */
function longText(text, cls = 'txt') {
  text = text == null ? '' : String(text);
  const lines = text.split('\n');
  const wrap = h('div', { class: 'lt' });
  const pre = h('pre', { class: cls });
  wrap.append(pre);
  const long = lines.length > LONG_LINES || text.length > LONG_CHARS;
  const q = S.f.q && S.f.q.toLowerCase();
  if (!long || (q && text.toLowerCase().includes(q))) {
    pre.textContent = text;
    if (long) wrap.append(h('button', { class: 'btn tiny more', onclick: () => { pre.textContent = preview(); btn(); } }, 'collapse'));
    return wrap;
  }
  function preview() {
    let p = lines.slice(0, LONG_LINES).join('\n');
    if (p.length > LONG_CHARS) p = p.slice(0, LONG_CHARS);
    return p + ' …';
  }
  function btn() {
    wrap.querySelector('.more')?.remove();
    wrap.append(h('button', {
      class: 'btn tiny more', onclick: (e) => {
        pre.textContent = text; e.target.remove();
        wrap.append(h('button', { class: 'btn tiny more', onclick: () => { pre.textContent = preview(); btn(); } }, 'collapse'));
        highlight(wrap);
      },
    }, `show all (${lines.length} lines, ${fmtK(text.length)} chars)`));
  }
  pre.textContent = preview();
  wrap.dataset.long = '1';
  wrap._expand = () => wrap.querySelector('.more')?.click();
  btn();
  return wrap;
}

/* Plain text with a per-block "render Markdown" toggle (D8). */
function textBlockBody(text) {
  const box = h('div');
  let md = false;
  const render = () => { box.replaceChildren(md ? markdown(text) : longText(text)); highlight(box); };
  render();
  box._toggleMd = (btn) => { md = !md; btn.classList.toggle('on', md); render(); };
  return box;
}

function markdown(src) {
  const out = h('div', { class: 'md' });
  const lines = String(src).split('\n');
  let i = 0, list = null, para = [];
  const flush = () => { if (para.length) { out.append(h('p', null, inline(para.join(' ')))); para = []; } };
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*```/);
    if (fence) {
      flush(); list = null;
      const body = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      out.append(h('pre', null, body.join('\n'))); i++; continue;
    }
    const hd = line.match(/^(#{1,6})\s+(.*)/);
    const li = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)/);
    if (hd) { flush(); list = null; out.append(h('h' + Math.min(hd[1].length, 4), null, inline(hd[2]))); }
    else if (li) {
      flush();
      const ordered = /\d/.test(li[1]);
      if (!list || list.tagName !== (ordered ? 'OL' : 'UL')) { list = h(ordered ? 'ol' : 'ul'); out.append(list); }
      list.append(h('li', null, inline(li[2])));
    } else if (!line.trim()) { flush(); list = null; }
    else { list = null; para.push(line); }
    i++;
  }
  flush();
  return out;
}
function inline(s) {
  const frag = document.createDocumentFragment();
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    frag.append(s.slice(last, m.index));
    const t = m[0];
    if (t[0] === '`') frag.append(h('code', null, t.slice(1, -1)));
    else if (t.startsWith('**')) frag.append(h('b', null, t.slice(2, -2)));
    else if (t[0] === '*') frag.append(h('i', null, t.slice(1, -1)));
    else {
      const mm = t.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const safe = /^https?:\/\//.test(mm[2]);
      frag.append(safe ? h('a', { href: mm[2], target: '_blank', rel: 'noopener noreferrer' }, mm[1]) : t);
    }
    last = m.index + t.length;
  }
  frag.append(s.slice(last));
  return frag;
}

/* JSON viewer: syntax colored, collapsible, depth > 2 starts collapsed, lazy children. */
function jsonView(value, depth = 0) {
  const root = h('div', { class: 'jv' });
  root.append(jsonNode(value, depth));
  return root;
}
function jsonNode(v, depth) {
  if (v === null) return h('span', { class: 'jnull' }, 'null');
  if (typeof v === 'string') return jsonString(v);
  if (typeof v === 'number') return h('span', { class: 'jn' }, String(v));
  if (typeof v === 'boolean') return h('span', { class: 'jb' }, String(v));
  const arr = Array.isArray(v);
  const keys = arr ? v.map((_, i) => i) : Object.keys(v);
  if (!keys.length) return h('span', { class: 'jnull' }, arr ? '[]' : '{}');
  const d = h('details', { class: 'jnode' });
  d.append(h('summary', null, arr ? `[ ${keys.length} items ]` : `{ ${keys.length} keys }`));
  let built = false;
  const build = () => {
    if (built) return; built = true;
    const c = h('span', { class: 'jc' });
    for (const k of keys) {
      c.append(h('span', { class: 'jrow' }, arr ? null : h('span', { class: 'jk' }, JSON.stringify(k)), arr ? null : ': ',
        jsonNode(v[k], depth + 1)));
    }
    d.append(c);
    highlight(c);
  };
  d.addEventListener('toggle', () => d.open && build());
  if (depth <= 2) { d.open = true; build(); }
  return d;
}
function jsonString(s) {
  const q = JSON.stringify(s);
  if (q.length <= 300 && !s.includes('\n')) return h('span', { class: 'js' }, q);
  const span = h('span', { class: 'js' });
  const lines = s.split('\n').length;
  const short = () => { span.textContent = JSON.stringify(s.slice(0, 200)).slice(0, -1) + '…"'; };
  short();
  const b = h('button', {
    class: 'btn tiny', onclick: (e) => {
      e.stopPropagation();
      if (b.dataset.open) { short(); b.textContent = `show all (${lines} lines, ${fmtK(s.length)} chars)`; delete b.dataset.open; }
      else { span.textContent = '"' + s + '"'; b.textContent = 'collapse'; b.dataset.open = '1'; highlight(span); }
    },
  }, `show all (${lines} lines, ${fmtK(s.length)} chars)`);
  return h('span', null, span, ' ', b);
}

/* A tool input: code-like strings become code blocks, the rest JSON. */
function toolInputView(input) {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) return jsonView(input);
  if (input._unparsed != null) return h('div', null, h('div', { class: 'errtag' }, 'could not parse tool input'), longText(input._unparsed, 'code'));
  const box = h('div', { class: 'tin' });
  for (const [k, v] of Object.entries(input)) {
    box.append(h('div', { class: 'tk' }, k));
    if (typeof v === 'string' && (CODE_KEYS.has(k) || v.includes('\n'))) box.append(longText(v, 'code'));
    else box.append(jsonView(v, 1));
  }
  return box;
}

/* A block card: kind badge + title + size + actions, collapsible. */
function blk(kind, opts, body) {
  const d = h('details', { class: `blk k-${kind}${opts.error ? ' is-error' : ''}` });
  if (opts.open !== false) d.open = true;
  const acts = h('span', { class: 'acts' });
  if (opts.md) acts.append(h('button', { class: 'btn tiny', title: 'render Markdown', onclick: (e) => { e.preventDefault(); e.stopPropagation(); opts.md._toggleMd(e.target); } }, 'MD'));
  if (opts.copy != null) acts.append(copyBtn(opts.copy));
  d.append(h('summary', null, kindBadge(kind), opts.title ? h('span', { class: 'bt' }, opts.title) : null,
    opts.extra || null, opts.size != null ? h('span', { class: 'size' }, sizeText(opts.size)) : null, acts));
  if (typeof body === 'function') {
    let built = false;
    const build = () => { if (!built) { built = true; const b = h('div', { class: 'bb' }, body()); d.append(b); highlight(b); } };
    d.addEventListener('toggle', () => d.open && build());
    if (d.open) build();
  } else d.append(h('div', { class: 'bb' }, body));
  return d;
}

function section(title, kind, opts, bodyFn) {
  const d = h('details', { class: `sec${kind ? ' k-' + kind : ''}` });
  if (opts.open) d.open = true;
  const acts = h('span', { class: 'acts' },
    h('button', { class: 'btn tiny', title: 'expand all', onclick: (e) => { e.preventDefault(); e.stopPropagation(); d.open = true; setTimeout(() => expandAll(d, true)); } }, 'expand all'),
    h('button', { class: 'btn tiny', title: 'collapse all', onclick: (e) => { e.preventDefault(); e.stopPropagation(); expandAll(d, false); } }, 'collapse all'),
    opts.copy != null ? copyBtn(opts.copy) : null);
  d.append(h('summary', null, kind ? kindBadge(kind) : null, h('h3', null, title),
    opts.size != null ? h('span', { class: 'size' }, sizeText(opts.size)) : null, opts.extra || null, acts));
  let built = false;
  const build = () => { if (!built) { built = true; const b = h('div', { class: 'sb' }, bodyFn()); d.append(b); highlight(b); } };
  d.addEventListener('toggle', () => d.open && build());
  if (d.open) build();
  return d;
}
function expandAll(root, open) {
  // Repeat so lazily built children open too.
  for (let pass = 0; pass < (open ? 4 : 1); pass++) {
    root.querySelectorAll('details').forEach((d) => { if (d !== root || open) d.open = open; });
    if (open) root.querySelectorAll('[data-long]').forEach((w) => w._expand && w._expand());
  }
}

// ------------------------------------------------------------------ messages and blocks
function blocksOf(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? content : [];
}
function resultText(b) {
  if (typeof b.content === 'string') return b.content;
  return blocksOf(b.content).map((x) => x.type === 'text' ? x.text : `[${x.type}]`).join('\n');
}
function cacheMark(b) {
  if (!b || !b.cache_control) return null;
  const cc = b.cache_control;
  return h('div', { class: 'cachemark', title: 'prompt-cache breakpoint: everything above is cached' },
    `cache breakpoint · ${cc.type || ''}${cc.ttl ? ' · ttl ' + cc.ttl : ''}`);
}

function textBlk(kind, text, extra) {
  const body = textBlockBody(text);
  return blk(kind, { size: text.length, copy: text, md: body, extra }, body);
}

function blockView(b, role, ctx) {
  const t = b.type;
  if (t === 'text') {
    const e = textBlk(role === 'assistant' ? 'assistant' : 'user', b.text || '',
      role === 'user' && /^\s*<system-reminder>/.test(b.text || '') ? h('span', { class: 'size' }, 'injected by harness') : null);
    return [e, cacheMark(b)];
  }
  if (t === 'thinking' || t === 'redacted_thinking') {
    const text = t === 'thinking' ? (b.thinking || '') : '[redacted thinking]';
    const body = textBlockBody(text);
    return [blk('thinking', { open: false, size: text.length, copy: text, md: body }, body), cacheMark(b)];
  }
  if (t === 'tool_use' || t === 'server_tool_use' || t === 'mcp_tool_use') return [toolCallCard(b, ctx), cacheMark(b)];
  if (t === 'tool_result') return [toolResultCard(b, ctx), cacheMark(b)];
  if (t === 'image' || t === 'document') {
    return [blk(role === 'assistant' ? 'assistant' : 'user', { title: `[${t}]` },
      h('div', { class: 'note' }, `${t} · ${b.source?.media_type || b.source?.type || ''}`)), cacheMark(b)];
  }
  return [blk(role === 'assistant' ? 'assistant' : 'user', { title: `[${t}]`, open: false, copy: JSON.stringify(b, null, 2) },
    () => jsonView(b)), cacheMark(b)];
}

function toolCallCard(b, ctx) {
  const input = b.input !== undefined ? b.input : (b._partial_json != null ? { _streaming: b._partial_json } : {});
  const res = ctx.pairedResults ? ctx.pairedResults[b.id] : null;
  const isErrorRes = res && res.is_error;
  const body = () => {
    const parts = [b._partial_json != null && b.input === undefined
      ? h('div', null, h('div', { class: 'note' }, 'receiving input…'), longText(b._partial_json, 'code'))
      : toolInputView(input)];
    if (ctx.pairedResults) {
      const pair = h('div', { class: 'pair' });
      if (res) {
        const text = resultText(res.block || {});
        pair.append(h('div', { class: 'ph' }, kindBadge('tool_result'),
          isErrorRes ? h('span', { class: 'errtag' }, '✗ is_error') : h('span', { class: 'okt' }, '✓'),
          h('span', { class: 'size' }, sizeText(text.length)),
          res.exchange_id !== ctx.id ? xlink(res.exchange_id, `result in #${res.exchange_id} →`) : null,
          copyBtn(text)));
        pair.append(longText(text, 'code'));
      } else {
        const never = ctx.summary && ctx.summary.anomalies.some((a) => a.code === 'unanswered' && a.msg.includes(b.id));
        pair.append(h('div', { class: 'pending-res' + (never ? ' bad' : '') }, never ? '⚠ never received a result' : 'awaiting result…'));
      }
      parts.push(pair);
    }
    return parts;
  };
  return blk('tool_call', {
    title: b.name || '?', error: isErrorRes,
    extra: h('span', { class: 'id' }, b.id || ''),
    copy: () => JSON.stringify(b.input ?? b._partial_json ?? {}, null, 2),
  }, body);
}

function toolResultCard(b, ctx) {
  const call = ctx.pairedCalls ? ctx.pairedCalls[b.tool_use_id] : null;
  const text = resultText(b);
  return blk('tool_result', {
    title: call ? call.name : '', error: !!b.is_error, size: text.length, copy: text,
    extra: h('span', null, b.is_error ? h('span', { class: 'errtag' }, '✗ is_error ') : null,
      h('span', { class: 'id' }, b.tool_use_id || ''), ' ',
      call && call.exchange_id !== ctx.id ? xlink(call.exchange_id, `← called in #${call.exchange_id}`) : null),
  }, () => {
    const parts = [longText(text, 'code')];
    blocksOf(b.content).filter((x) => x.type !== 'text').forEach((x) => parts.push(h('div', { class: 'note' }, `[${x.type}] ${x.source?.media_type || ''}`)));
    return parts;
  });
}

function messageView(m, index, ctx, extraNote) {
  const role = m.role || '?';
  const card = h('div', { class: `msg role-${role}${extraNote === 'echo' ? ' echo' : ''}` });
  card.append(h('div', { class: 'mh' }, h('span', { class: 'role' }, role), `message ${index + 1}`,
    extraNote === 'echo' ? h('span', null, `· echo of #${ctx.summary.prev_id}'s reply`) : null));
  const mb = h('div', { class: 'mb' });
  for (const b of blocksOf(m.content)) mb.append(...blockView(b, role, ctx).filter(Boolean));
  card.append(mb);
  return card;
}

function xlink(id, label) {
  return h('a', { class: 'xlink', onclick: (e) => { e.preventDefault(); e.stopPropagation(); select(id, true); } }, label);
}

// ------------------------------------------------------------------ list pane
function matches(s) {
  const f = S.f;
  if (s.kind !== 'messages' && !f.other) return false;
  if (f.session && s.session_id !== f.session) return false;
  if (f.lane && String(s.lane) !== f.lane) return false;
  if (f.model && s.model !== f.model) return false;
  if (f.errors && !isWarn(s)) return false;
  if (f.tools.length) {
    const names = new Set([...s.tool_calls.map((c) => c.name), ...s.tool_results.map((r) => r.name)]);
    if (!f.tools.some((t) => names.has(t))) return false;
  }
  if (S.searchIds && !S.searchIds.has(s.id)) return false;
  return true;
}

function rowFor(s) {
  const el = h('div', { class: 'row', role: 'option', dataset: { id: s.id } });
  fillRow(el, s);
  return el;
}
function fillRow(el, s) {
  const other = s.kind !== 'messages';
  el.className = 'row' + (other ? ' other' : '') + (isErr(s) ? ' err' : isWarn(s) ? ' warn' : '') + (S.sel === s.id ? ' sel' : '')
    + (el.classList.contains('new') ? ' new' : '');
  let st;
  if (s.state === 'pending' || s.state === 'streaming') st = h('span', { class: 'st', title: s.state }, h('span', { class: 'spin' }));
  else if (isErr(s)) st = h('span', { class: 'st bad', title: s.anomalies.map((a) => a.msg).join('\n') }, '⚠');
  else if (isWarn(s)) st = h('span', { class: 'st warnc', title: s.anomalies.map((a) => a.msg).join('\n') }, '⚠');
  else st = h('span', { class: 'st ok', title: s.state }, '✓');
  const u = s.usage;
  const meta = other
    ? [s.status || '', ' ', fmtMs(s.duration_ms)]
    : [s.state === 'streaming' ? 'streaming… ' : '', fmtMs(s.duration_ms), s.finished_at ? ` · ${fmtK(totalIn(u))}/${fmtK(u.output)} · ${fmtCost(s.cost_usd)}` : ''];
  const r1 = h('div', { class: 'r1' }, h('span', { class: 'rid' }, '#' + s.id), timeEl(s.started_at), st,
    other ? h('span', { class: 'mono' }, `${s.method} ${s.path.slice(0, 40)}`) : h('span', { class: 'lane', title: `lane ${s.lane} (${s.lane_role}) · session ${s.session_id}` }, `L${s.lane}`),
    h('span', { class: 'meta' }, ...meta));
  el.replaceChildren(r1);
  if (other) return;
  const g = s.gist || { kind: 'other', text: '' };
  const gk = g.kind === 'other' ? null : g.kind;
  const r2 = h('div', { class: 'r2' }, gk ? kindBadge(gk, true) : null, h('span', { class: 'gist', title: g.text }, g.text || '—'));
  el.append(r2);
  const chips = h('div', { class: 'r3' });
  const counts = new Map();
  for (const c of s.tool_calls) counts.set(c.name, (counts.get(c.name) || 0) + 1);
  for (const [name, n] of counts) chips.append(h('span', { class: 'chip', title: 'tool call' }, `${KINDS.tool_call.icon} ${name}${n > 1 ? ' ×' + n : ''}`));
  const errs = s.tool_results.filter((r) => r.is_error);
  if (errs.length) chips.append(h('span', { class: 'chip res bad', title: 'tool result with is_error' }, `${KINDS.tool_result.icon} ✗ ${errs.map((r) => r.name).join(', ')}`));
  if (s.stop_reason === 'max_tokens') chips.append(h('span', { class: 'chip bad' }, 'max_tokens'));
  if (s.relation === 'rewritten') chips.append(h('span', { class: 'chip res', title: 'earlier messages differ from the previous request' }, 'history rewritten'));
  if (chips.childNodes.length) el.append(chips);
  if (S.f.q) highlight(el);
}

function upsertRow(s, isNew) {
  let el = S.rows.get(s.id);
  const list = $('list');
  if (!el) {
    el = rowFor(s);
    S.rows.set(s.id, el);
    // insert by id, newest first
    let before = null;
    for (const child of list.children) { if (+child.dataset.id < s.id) { before = child; break; } }
    const shown = matches(s);
    el.hidden = !shown;
    const keep = isNew && shown && (list.scrollTop > 2 || S.sel != null);
    const prevH = list.scrollHeight;
    list.insertBefore(el, before);
    if (isNew && shown) {
      el.classList.add('new');
      setTimeout(() => el.classList.remove('new'), 400);
      if (keep) {
        list.scrollTop += list.scrollHeight - prevH;
        S.newCount++; showPill();
      }
    }
  } else {
    fillRow(el, s);
    el.hidden = !matches(s);
  }
  $('list-empty').hidden = S.ex.size > 0;
}
function showPill() {
  const p = $('newpill');
  p.hidden = S.newCount === 0;
  p.textContent = `${S.newCount} new ↑`;
}
function refilter() {
  for (const [id, el] of S.rows) el.hidden = !matches(S.ex.get(id));
  updateTotals();
  if (!$('stats').hidden) scheduleStats();
}

// ------------------------------------------------------------------ filters UI
function rebuildSelect(sel, values, current, label) {
  const keep = sel.value;
  const opts = [h('option', { value: '' }, 'all')];
  for (const [v, text] of values) opts.push(h('option', { value: v }, text));
  sel.replaceChildren(...opts);
  sel.value = current || keep || '';
  if (sel.value !== (current || '')) sel.value = '';
  void label;
}
let filtersTimer = null;
function scheduleFilterLists() {
  if (filtersTimer) return;
  filtersTimer = setTimeout(() => { filtersTimer = null; buildFilterLists(); }, 300);
}
function buildFilterLists() {
  const sessions = new Map(), models = new Map(), lanes = new Map(), tools = new Map();
  for (const s of S.ex.values()) {
    if (s.kind !== 'messages') continue;
    const ss = sessions.get(s.session_id) || { n: 0, t: s.started_at };
    ss.n++; sessions.set(s.session_id, ss);
    if (s.model) models.set(s.model, (models.get(s.model) || 0) + 1);
    if (!S.f.session || s.session_id === S.f.session) {
      const l = lanes.get(s.lane) || { n: 0, role: s.lane_role }; l.n++; lanes.set(s.lane, l);
    }
    for (const c of s.tool_calls) tools.set(c.name, (tools.get(c.name) || 0) + 1);
  }
  rebuildSelect($('f-session'), [...sessions].sort((a, b) => b[1].t - a[1].t)
    .map(([k, v]) => [k, `${k.length > 13 ? k.slice(0, 8) + '…' : k} · ${v.n} req · ${fmtTime(v.t)}`]), S.f.session);
  rebuildSelect($('f-lane'), [...lanes].sort((a, b) => a[0] - b[0]).map(([k, v]) => [String(k), `L${k} · ${v.role} · ${v.n}`]), S.f.lane);
  rebuildSelect($('f-model'), [...models].map(([k, n]) => [k, `${k} · ${n}`]), S.f.model);
  const tl = $('tools-list');
  const names = [...new Set([...tools.keys(), ...S.f.tools])].sort();
  tl.replaceChildren(...names.map((name) => h('label', null,
    h('input', { type: 'checkbox', checked: S.f.tools.includes(name), onchange: (e) => {
      S.f.tools = e.target.checked ? [...S.f.tools, name] : S.f.tools.filter((t) => t !== name);
      $('tools-count').textContent = S.f.tools.length ? S.f.tools.length : '';
      saveHash(); refilter();
    } }), `${KINDS.tool_call.icon} ${name}`, h('span', { class: 'size' }, tools.get(name) || 0))));
  if (!names.length) tl.append(h('div', { class: 'note' }, 'no tool calls yet'));
  tl.append(h('div', { class: 'row-btns' }, h('button', { class: 'btn tiny', onclick: () => { S.f.tools = []; buildFilterLists(); saveHash(); refilter(); } }, 'clear')));
  $('tools-count').textContent = S.f.tools.length ? S.f.tools.length : '';
}
function buildKindsMenu() {
  const pop = $('kinds-pop');
  pop.querySelectorAll('label').forEach((l) => l.remove());
  for (const k of Object.keys(KINDS)) {
    pop.append(h('label', null, h('input', { type: 'checkbox', checked: !S.f.hide.includes(k), onchange: (e) => setHidden(k, !e.target.checked) }), kindBadge(k)));
  }
  $('kinds-count').textContent = S.f.hide.length ? `${8 - S.f.hide.length}/8` : '';
}
function setHidden(kind, hidden) {
  S.f.hide = hidden ? [...new Set([...S.f.hide, kind])] : S.f.hide.filter((x) => x !== kind);
  applyHidden(); buildKindsMenu(); saveHash();
  document.querySelectorAll('.kindbar .kb').forEach((b) => b.classList.toggle('off', S.f.hide.includes(b.dataset.kind)));
}
function applyHidden() {
  const d = $('detail');
  for (const k of Object.keys(KINDS)) d.classList.toggle('hide-' + k, S.f.hide.includes(k));
}

let searchTimer = null, searchSeq = 0;
function runSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const q = S.f.q.trim();
    if (!q) { S.searchIds = null; refilter(); rerenderDetail(); return; }
    const seq = ++searchSeq;
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&scope=${S.f.scope || 'messages'}`).then((x) => x.json());
      if (seq !== searchSeq) return;
      S.searchIds = new Set(r.ids);
      refilter();
      for (const [id, el] of S.rows) if (!el.hidden) fillRow(el, S.ex.get(id));
      rerenderDetail();
    } catch (_) { /* ignore */ }
  }, 250);
}

/* Wrap search matches in <mark>. */
function highlight(root) {
  const q = S.f.q && S.f.q.trim().toLowerCase();
  if (!q || !root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => n.parentNode && n.parentNode.nodeName !== 'MARK' && n.nodeValue.toLowerCase().includes(q)
      ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const text = n.nodeValue, lower = text.toLowerCase();
    const frag = document.createDocumentFragment();
    let i = 0, j;
    while ((j = lower.indexOf(q, i)) !== -1) {
      frag.append(text.slice(i, j), h('mark', null, text.slice(j, j + q.length)));
      i = j + q.length;
    }
    frag.append(text.slice(i));
    n.parentNode.replaceChild(frag, n);
  }
}

// ------------------------------------------------------------------ URL hash state
function saveHash() {
  const p = new URLSearchParams();
  const f = S.f;
  if (S.sel != null) p.set('sel', S.sel);
  if (S.tab !== 'overview') p.set('tab', S.tab);
  for (const k of ['session', 'lane', 'model', 'q', 'scope']) if (f[k]) p.set(k, f[k]);
  if (f.tools.length) p.set('tools', f.tools.join(','));
  if (f.hide.length) p.set('hide', f.hide.join(','));
  if (f.errors) p.set('errors', '1');
  if (f.other) p.set('other', '1');
  if (!$('stats').hidden) p.set('stats', '1');
  history.replaceState(null, '', '#' + p.toString());
}
function loadHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const f = S.f;
  for (const k of ['session', 'lane', 'model', 'q', 'scope']) f[k] = p.get(k) || '';
  f.tools = p.get('tools') ? p.get('tools').split(',') : [];
  f.hide = p.get('hide') ? p.get('hide').split(',').filter((k) => KINDS[k]) : [];
  f.errors = p.get('errors') === '1';
  f.other = p.get('other') === '1';
  S.tab = p.get('tab') || 'overview';
  S.sel = p.get('sel') ? +p.get('sel') : null;
  $('f-q').value = f.q; $('f-scope').checked = f.scope === 'all';
  $('f-errors').checked = f.errors; $('f-other').checked = f.other;
  if (p.get('stats') === '1') toggleStats(true);
}

// ------------------------------------------------------------------ totals
function visibleMessages() {
  const out = [];
  for (const s of S.ex.values()) if (s.kind === 'messages' && matches(s)) out.push(s);
  return out.sort((a, b) => a.id - b.id);
}
function totalsOf(list) {
  const t = { n: list.length, in: 0, out: 0, cr: 0, cw: 0, unc: 0, cost: 0, errors: 0, first: Infinity, last: 0 };
  for (const s of list) {
    const u = s.usage;
    t.unc += u.input; t.cr += u.cache_read; t.cw += u.cache_write; t.in += totalIn(u); t.out += u.output;
    t.cost += s.cost_usd || 0;
    if (isErr(s)) t.errors++;
    t.first = Math.min(t.first, s.started_at);
    t.last = Math.max(t.last, s.finished_at || s.started_at);
  }
  t.wall = t.n ? t.last - t.first : 0;
  return t;
}
let totalsTimer = null;
function updateTotals() {
  if (totalsTimer) return;
  totalsTimer = setTimeout(() => {
    totalsTimer = null;
    const t = totalsOf(visibleMessages());
    const el = $('totals');
    if (!t.n) { el.textContent = S.ex.size ? 'no matching requests' : 'no traffic yet'; return; }
    el.replaceChildren(h('b', null, t.n), ` request${t.n === 1 ? '' : 's'} · `, h('b', null, fmtK(t.in)), ' in (cache read ',
      fmtK(t.cr), ', write ', fmtK(t.cw), ') / ', h('b', null, fmtK(t.out)), ' out · ', h('b', null, fmtCost(t.cost)), ' est. · ',
      fmtWall(t.wall), t.errors ? h('span', { class: 'err' }, ` · ⚠ ${t.errors} error${t.errors > 1 ? 's' : ''}`) : '');
  }, 150);
}

// ------------------------------------------------------------------ detail pane
async function select(id, scrollIntoView) {
  if (S.sel !== id) {
    const old = S.rows.get(S.sel); if (old) old.classList.remove('sel');
  }
  S.sel = id;
  const row = S.rows.get(id);
  if (row) { row.classList.add('sel'); if (scrollIntoView) row.scrollIntoView({ block: 'nearest' }); }
  saveHash();
  const s = S.ex.get(id);
  if (!s) { $('detail').replaceChildren(h('div', { class: 'empty' }, `#${id} is not loaded.`)); return; }
  S.detail = S.detailCache.get(id) && S.detailCache.get(id)._state === s.state && !S.detailCache.get(id)._stale ? S.detailCache.get(id) : null;
  if (!S.detail) {
    renderDetail(true);
    await fetchDetail(id);
  }
  if (S.sel === id) renderDetail();
}
async function fetchDetail(id) {
  try {
    const d = await fetch(`/api/exchanges/${id}`).then((r) => r.ok ? r.json() : null);
    if (!d) return;
    d._state = d.state;
    S.detailCache.set(id, d);
    if (S.detailCache.size > 30) S.detailCache.delete(S.detailCache.keys().next().value);
    if (S.sel === id) S.detail = d;
  } catch (_) { /* ignore */ }
}

const TABS = [['overview', 'Overview'], ['request', 'Request'], ['reply', 'Reply'], ['changes', 'Changes'], ['raw', 'Raw']];

function renderDetail(loading) {
  const pane = $('detail');
  const s = S.ex.get(S.sel);
  if (!s) return;
  const scroll = pane.scrollTop;
  const d = S.detail;
  const u = s.usage;
  const statusCls = s.status == null ? '' : s.status >= 400 ? 'status-bad' : 'status-ok';
  const head = h('div', { class: 'dh' },
    h('h2', null, `#${s.id}`, h('span', { class: 'path' }, `${s.method} ${s.path}`),
      h('span', { class: statusCls }, s.status == null ? s.state : `${s.status}`),
      s.duration_ms != null ? h('span', { class: 'size' }, '· ' + fmtMs(s.duration_ms)) : null,
      s.state === 'streaming' || s.state === 'pending' ? h('span', { class: 'spin', title: s.state }) : null),
    h('div', { class: 'sub' },
      s.model ? h('span', { class: 'mono' }, s.model) : null,
      s.kind === 'messages' ? h('span', null, `in ${fmtK(totalIn(u))} (uncached ${fmtK(u.input)}, cache read ${fmtK(u.cache_read)}, write ${fmtK(u.cache_write)})`) : null,
      s.kind === 'messages' ? h('span', null, `out ${fmtK(u.output)}`) : null,
      s.kind === 'messages' ? h('span', { title: `price table entry: ${s.cost_source}` }, `${fmtCost(s.cost_usd)} est.`) : null,
      s.ttfb_ms != null ? h('span', null, `ttfb ${fmtMs(s.ttfb_ms)}`) : null,
      s.stop_reason ? h('span', null, `stop: ${s.stop_reason}`) : null,
      s.kind === 'messages' ? h('span', { title: `session ${s.session_id}` }, `lane L${s.lane} (${s.lane_role})`) : null,
      timeEl(s.started_at)),
    h('div', { class: 'tabs', role: 'tablist' },
      TABS.map(([k, label]) => h('button', { class: S.tab === k ? 'on' : '', role: 'tab', onclick: () => { S.tab = k; saveHash(); renderDetail(); $('detail').scrollTop = 0; } }, label)),
      h('span', { class: 'kindbar', title: 'click a kind to hide or show it' }, Object.keys(KINDS).map((k) => {
        const b = kindBadge(k); b.dataset.kind = k; b.classList.toggle('off', S.f.hide.includes(k));
        b.addEventListener('click', () => setHidden(k, !S.f.hide.includes(k)));
        return b;
      }))));
  const body = h('div', { class: 'db' });
  for (const a of s.anomalies) {
    body.append(h('div', { class: 'banner' + (a.level === 'error' ? '' : ' warn') }, h('b', null, '⚠ ' + a.code.replace('_', ' ')), h('span', null, a.msg)));
  }
  if (s.relation === 'rewritten') body.append(h('div', { class: 'banner info' }, h('b', null, 'history rewritten'),
    h('span', null, `earlier messages differ from #${s.prev_id} (compaction, edits, or a different conversation). See the Changes tab.`)));
  if (loading || !d) body.append(h('div', { class: 'empty' }, 'loading…'));
  else {
    const ctx = { id: s.id, summary: s, pairedResults: d.paired_results, pairedCalls: d.paired_calls };
    try {
      ({ overview: renderOverview, request: renderRequest, reply: renderReply, changes: renderChanges, raw: renderRaw })[S.tab](body, d, ctx);
    } catch (e) {
      body.append(h('div', { class: 'banner' }, h('b', null, 'render error'), h('span', null, String(e))));
      console.error(e);
    }
  }
  pane.replaceChildren(head, body);
  applyHidden();
  highlight(body);
  pane.scrollTop = scroll;
}
function rerenderDetail() { if (S.sel != null && S.detail) renderDetail(); }

function relationNote(s, d) {
  const r = d.request;
  switch (s.relation) {
    case 'append': return `Appended after #${s.prev_id}: ${s.msg_count - r.new_from} new message(s) of ${s.msg_count}`
      + (r.echo_index != null ? ` (message ${r.echo_index + 1} echoes #${s.prev_id}'s reply and is not repeated here).` : '.');
    case 'rewritten': return `History rewritten relative to #${s.prev_id}; showing the trailing user turn (messages ${r.new_from + 1}–${s.msg_count}).`;
    case 'independent': return `An independent call in this lane (no shared history with #${s.prev_id}).`;
    default: return r.new_from ? `First request in lane L${s.lane}; showing the trailing user turn (messages ${r.new_from + 1}–${s.msg_count} of ${s.msg_count}).`
      : `First request in lane L${s.lane}: all ${s.msg_count} message(s).`;
  }
}

function notParsed(body, d) {
  body.append(h('div', { class: 'banner info' }, h('b', null, 'not parsed'),
    h('span', null, d.kind === 'messages' ? 'The request could not be parsed. See the Raw tab.' :
      'Only the Anthropic Messages format is parsed (D4). The full request and reply are in the Raw tab.')));
}

function renderOverview(body, d, ctx) {
  if (!d.request.parsed) { notParsed(body, d); body.append(kvTable({ status: d.status, state: d.state, duration: fmtMs(d.duration_ms) })); return; }
  const r = d.request;
  const newMsgs = r.messages.slice(r.new_from);
  body.append(h('div', { class: 'sec k-user', open: true },
    h('div', { class: 'sh' }, kindBadge('user'), h('h3', null, 'New in this request'), h('span', { class: 'size' }, `${newMsgs.length} message(s)`)),
    h('div', { class: 'sb' }, h('div', { class: 'note' }, relationNote(ctx.summary, d)),
      newMsgs.length ? newMsgs.map((m, i) => messageView(m, r.new_from + i, ctx))
        : h('div', { class: 'note' }, ctx.summary.prev_id ? `Nothing new: the same conversation as #${ctx.summary.prev_id} was sent again (usually a retry).` : 'nothing new'))));
  body.append(replySection(d, ctx));
}

function replySection(d, ctx) {
  const resp = d.response;
  const s = ctx.summary;
  const box = h('div', { class: 'sb', id: 'reply-live' });
  fillReply(box, resp.content || [], resp, s, ctx);
  return h('div', { class: 'sec k-assistant' },
    h('div', { class: 'sh' }, kindBadge('assistant'), h('h3', null, 'Reply'),
      h('span', { class: 'size' }, s.stop_reason ? `stop_reason: ${s.stop_reason}` : s.state)),
    box);
}
function fillReply(box, content, resp, s, ctx) {
  const parts = [];
  if (resp.error) {
    parts.push(blk('error', { title: resp.error.type, copy: resp.error.message, error: true }, longText(resp.error.message || '')));
  } else if (s.status >= 400) {
    parts.push(blk('error', { title: `HTTP ${s.status}`, error: true }, h('div', { class: 'note' }, 'See the Raw tab for the reply body.')));
  }
  if (resp.note) parts.push(blk('error', { title: s.state, error: true }, longText(resp.note)));
  for (const b of content) parts.push(...blockView(b, 'assistant', ctx).filter(Boolean));
  if (!content.length && !parts.length) parts.push(h('div', { class: 'note' }, s.state === 'pending' ? 'waiting for the reply…' : s.state === 'streaming' ? 'streaming…' : 'no content'));
  if (s.state === 'streaming') parts.push(h('div', { class: 'note' }, h('span', { class: 'spin' }), ' streaming…'));
  box.replaceChildren(...parts);
  highlight(box);
}

function kvTable(obj) {
  const g = h('div', { class: 'kv' });
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    g.append(h('div', null, k), h('div', null, v !== null && typeof v === 'object' ? jsonView(v, 1) : String(v)));
  }
  return g;
}
function headersTable(headers) {
  const g = h('div', { class: 'kv' });
  for (const [k, v] of headers || []) g.append(h('div', null, k), h('div', { class: 'mono' }, v));
  return g;
}

function renderRequest(body, d, ctx) {
  const r = d.request;
  body.append(section('Parameters & headers', null, { open: false }, () => [
    kvTable({ model: r.model, max_tokens: r.max_tokens, temperature: r.temperature, thinking: r.thinking, stream: r.stream, metadata: r.metadata, ...r.other_params }),
    h('div', { class: 'note' }, 'Request headers (secrets redacted)'), headersTable(r.headers)]));
  if (!r.parsed) { notParsed(body, d); return; }
  const sysText = r.system.map((b) => b.text || '').join('\n\n');
  body.append(section('System', 'system', { open: false, size: sysText.length, copy: sysText, extra: h('span', { class: 'size' }, `${r.system.length} block(s)`) }, () =>
    r.system.length ? r.system.flatMap((b, i) => {
      const tb = textBlockBody(b.text || '');
      return [blk('system', { title: `block ${i + 1}`, size: (b.text || '').length, copy: b.text || '', md: tb }, tb), cacheMark(b)];
    }).filter(Boolean) : h('div', { class: 'note' }, 'no system prompt')));
  const toolsSize = JSON.stringify(r.tools).length;
  body.append(section(`Tools (${r.tools.length})`, 'tools', { open: false, size: toolsSize, copy: () => JSON.stringify(r.tools, null, 2) }, () =>
    r.tools.length ? r.tools.flatMap((t) => {
      const size = JSON.stringify(t).length;
      return [blk('tools', { title: t.name || t.type || '?', open: false, size, copy: () => JSON.stringify(t, null, 2),
        extra: t.type && !t.input_schema ? h('span', { class: 'size' }, t.type) : null }, () => [
        t.description ? textBlockBody(t.description) : null,
        t.input_schema ? h('div', { class: 'tk note' }, 'input_schema') : null,
        jsonView(t.input_schema || t, 0)]), cacheMark(t)];
    }).filter(Boolean) : h('div', { class: 'note' }, 'no tools offered')));
  const earlier = r.messages.slice(0, r.new_from);
  const earlierSize = earlier.reduce((n, m) => n + JSON.stringify(m.content).length, 0);
  body.append(section(`Conversation so far (${earlier.length} messages)`, null, { open: false, size: earlierSize }, () =>
    earlier.length ? earlier.map((m, i) => messageView(m, i, ctx, i === r.echo_index ? 'echo' : null)) : h('div', { class: 'note' }, 'none')));
  const newMsgs = r.messages.slice(r.new_from);
  body.append(section(`New message(s) (${newMsgs.length})`, 'user', { open: true, size: newMsgs.reduce((n, m) => n + JSON.stringify(m.content).length, 0),
    extra: h('span', { class: 'size' }, relationNote(ctx.summary, d)) }, () => newMsgs.map((m, i) => messageView(m, r.new_from + i, ctx))));
}

function renderReply(body, d, ctx) {
  const resp = d.response;
  const s = ctx.summary;
  body.append(replySection(d, ctx));
  body.append(section('Usage & timing', null, { open: true }, () => [
    kvTable({
      stop_reason: resp.stop_reason, stop_sequence: resp.stop_sequence ?? undefined,
      'input (uncached)': s.usage.input, 'cache read': s.usage.cache_read, 'cache write': s.usage.cache_write, output: s.usage.output,
      'cost (est.)': `${fmtCost(s.cost_usd)} — price entry "${s.cost_source}"`,
      started: new Date(s.started_at * 1000).toLocaleString(),
      'time to first byte': fmtMs(s.ttfb_ms), duration: fmtMs(s.duration_ms), state: s.state,
    }),
    h('div', { class: 'note' }, 'usage as returned by the API'), jsonView(resp.usage_raw, 1),
    resp.message && Object.keys(resp.message).length ? [h('div', { class: 'note' }, 'message'), jsonView(resp.message, 1)] : null,
  ]));
  body.append(section('Reply headers', null, { open: false }, () => headersTable(resp.headers)));
}

function diffView(lines) {
  const pre = h('pre', { class: 'diff' });
  for (const l of lines) {
    const cls = l.startsWith('@@') ? 'hunk' : l.startsWith('+++') || l.startsWith('---') ? 'hunk' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : null;
    pre.append(h('span', { class: cls || '' }, l + '\n'));
  }
  return pre;
}

function renderChanges(body, d, ctx) {
  const c = d.changes;
  if (!c || !c.available) { notParsed(body, d); return; }
  if (c.first) { body.append(h('div', { class: 'banner info' }, h('b', null, 'first request'), h('span', null, `First request in lane L${ctx.summary.lane}: nothing to compare.`))); return; }
  body.append(h('div', { class: 'note' }, 'Compared with ', xlink(c.prev_id, `#${c.prev_id}`), `, the previous request in lane L${ctx.summary.lane}.`));
  if (!c.system.changed && !c.tools.changed) body.append(h('div', { class: 'banner info' }, h('b', null, 'unchanged'), h('span', null, 'System prompt and tools are unchanged.')));
  if (c.system.changed) {
    body.append(section('System prompt changed', 'system', { open: true }, () =>
      c.system.diff.length ? diffView(c.system.diff) : h('div', { class: 'note' }, 'Only block structure or cache markers changed; the text is identical.')));
  }
  if (c.tools.changed) {
    body.append(section('Tool set changed', 'tools', { open: true }, () => [
      ['added', c.tools.added], ['removed', c.tools.removed], ['changed', c.tools.modified],
    ].filter(([, l]) => l.length).map(([k, l]) => h('div', null, h('b', null, k + ': '), l.join(', ')))));
  }
  body.append(section('Parameters', null, { open: true }, () => c.params.length
    ? h('ul', { class: 'plain' }, c.params.map((p) => h('li', null, h('span', { class: 'mono' }, p.name), ': ', JSON.stringify(p.before), ' → ', JSON.stringify(p.after))))
    : h('div', { class: 'note' }, 'model, max_tokens, thinking and temperature unchanged')));
  const m = c.messages;
  body.append(section('Messages', 'user', { open: true }, () => {
    if (m.mode === 'append') {
      return h('div', null, `Normal append: ${m.kept} earlier messages kept unchanged, ${m.added} added`
        + (m.echo_index != null ? ` (message ${m.echo_index + 1} is #${c.prev_id}'s reply).` : '.'));
    }
    if (m.mode === 'independent') return h('div', null, 'No shared history with the previous request in this lane.');
    return m.ops.map((op) => {
      if (op.op === 'equal') return h('div', { class: 'op' }, h('div', { class: 'oh' }, `= ${op.count} message(s) unchanged (messages ${op.from + 1}–${op.from + op.count})`));
      if (op.op === 'modified') return h('div', { class: 'op modified' }, h('div', { class: 'oh' }, `~ modified: ${op.role} message ${op.prev_index + 1} → ${op.index + 1}`), diffView(op.diff));
      return h('div', { class: 'op ' + op.op }, h('div', { class: 'oh' }, `${op.op === 'added' ? '+ added' : '− removed'}: ${op.role} message ${(op.op === 'added' ? op.index : op.prev_index) + 1}`),
        longText(op.preview, 'code'));
    });
  }));
}

async function renderRaw(body, d) {
  const holder = h('div', null, h('div', { class: 'empty' }, 'loading raw…'));
  body.append(holder);
  const id = d.id;
  let raw;
  try { raw = await fetch(`/api/exchanges/${id}/raw`).then((r) => r.json()); } catch (_) { return; }
  if (S.sel !== id || S.tab !== 'raw') return;
  holder.replaceChildren(
    section('Request', null, { open: true, size: raw.request.length, copy: raw.request }, () => [
      headersTable(raw.request_headers), h('div', { class: 'note' }, 'body (secrets are only ever in headers, which are redacted)'),
      h('pre', { class: 'raw' }, raw.request || '(empty)')]),
    section(`Reply ${raw.status ?? ''} ${raw.reason || ''}`, null, { open: true, size: raw.response.length, copy: raw.response }, () => [
      headersTable(raw.response_headers), h('pre', { class: 'raw' }, raw.response || '(empty)')]));
  highlight(holder);
}

// ------------------------------------------------------------------ stats drawer
function toggleStats(force) {
  const st = $('stats');
  st.hidden = force != null ? !force : !st.hidden;
  $('b-stats').setAttribute('aria-expanded', String(!st.hidden));
  $('b-stats').classList.toggle('on', !st.hidden);
  $('b-stats').textContent = st.hidden ? 'Stats ▾' : 'Stats ▴';
  if (!st.hidden) renderStats();
  saveHash();
}
let statsTimer = null;
function scheduleStats() {
  if (statsTimer) return;
  statsTimer = setTimeout(() => { statsTimer = null; if (!$('stats').hidden) renderStats(); }, 1000);
}

const tip = {
  show(e, text) { const t = $('tip'); t.textContent = text; t.hidden = false; tip.move(e); },
  move(e) { const t = $('tip'); const x = Math.min(e.clientX + 14, innerWidth - t.offsetWidth - 8); t.style.left = x + 'px'; t.style.top = (e.clientY + 14) + 'px'; },
  hide() { $('tip').hidden = true; },
};
const NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid != null) el.append(kid);
  return el;
}
function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/* Stacked bars, one per request; click opens the exchange. */
function stackedBars(list, series, valueFmt, tipFn) {
  const H = 150, padL = 44, padB = 18, padT = 6;
  const bw = Math.max(4, Math.min(18, Math.floor(560 / Math.max(list.length, 1)) - 2));
  const W = padL + list.length * (bw + 2) + 8;
  const max = niceMax(Math.max(1, ...list.map((s) => series.reduce((n, se) => n + se.get(s), 0))));
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  const g = svg('svg', { width: Math.max(W, 300), height: H, role: 'img' });
  for (const f of [0, 0.5, 1]) {
    g.append(svg('line', { x1: padL, x2: Math.max(W, 300), y1: y(max * f), y2: y(max * f), class: f === 0 ? 'axis' : 'grid' }));
    g.append(svg('text', { x: padL - 4, y: y(max * f) + 3, 'text-anchor': 'end' }, valueFmt(max * f)));
  }
  list.forEach((s, i) => {
    const x = padL + 4 + i * (bw + 2);
    let acc = 0;
    const segs = series.filter((se) => se.get(s) > 0);
    segs.forEach((se, j) => {
      const v = se.get(s);
      const y0 = y(acc), y1 = y(acc + v);
      // 1px surface gap between stacked segments
      const top = j === segs.length - 1;
      const hgt = Math.max(0, y0 - y1 - (j > 0 ? 1 : 0));
      g.append(svg('rect', { x, y: y1, width: bw, height: hgt, fill: `var(${se.color})`, rx: top ? Math.min(2, bw / 3) : 0 }));
      acc += v;
    });
    if (i % Math.ceil(list.length / 10) === 0) g.append(svg('text', { x: x + bw / 2, y: H - 5, 'text-anchor': 'middle' }, '#' + s.id));
    const hit = svg('rect', { x: x - 1, y: padT, width: bw + 2, height: H - padT - padB, class: 'hit' });
    hit.addEventListener('mousemove', (e) => tip.show(e, tipFn(s)));
    hit.addEventListener('mouseleave', tip.hide);
    hit.addEventListener('click', () => { tip.hide(); select(s.id, true); });
    g.append(hit);
  });
  return g;
}

function lineChart(list, getY, lineSet, tipFn) {
  const H = 150, padL = 44, padB = 18, padT = 6;
  const step = Math.max(4, Math.min(18, Math.floor(560 / Math.max(list.length, 1))));
  const W = Math.max(300, padL + list.length * step + 12);
  const max = niceMax(Math.max(1, ...list.map(getY)));
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  const x = (i) => padL + 6 + i * step;
  const g = svg('svg', { width: W, height: H, role: 'img' });
  for (const f of [0, 0.5, 1]) {
    g.append(svg('line', { x1: padL, x2: W, y1: y(max * f), y2: y(max * f), class: f === 0 ? 'axis' : 'grid' }));
    g.append(svg('text', { x: padL - 4, y: y(max * f) + 3, 'text-anchor': 'end' }, fmtK(max * f)));
  }
  const pts = list.map((s, i) => [x(i), y(getY(s)), s]);
  const main = pts.filter((p) => lineSet(p[2]));
  if (main.length > 1) g.append(svg('polyline', { points: main.map((p) => p[0] + ',' + p[1]).join(' '), fill: 'none', stroke: 'var(--s1)', 'stroke-width': 2, 'stroke-linejoin': 'round' }));
  pts.forEach(([px, py, s], i) => {
    const on = lineSet(s);
    g.append(svg('circle', { cx: px, cy: py, r: on ? 3 : 2.5, fill: on ? 'var(--s1)' : 'var(--muted)', stroke: 'var(--bg)', 'stroke-width': 1 }));
    if (i % Math.ceil(list.length / 10) === 0) g.append(svg('text', { x: px, y: H - 5, 'text-anchor': 'middle' }, '#' + s.id));
    const hit = svg('rect', { x: px - step / 2, y: padT, width: step, height: H - padT - padB, class: 'hit' });
    hit.addEventListener('mousemove', (e) => tip.show(e, tipFn(s)));
    hit.addEventListener('mouseleave', tip.hide);
    hit.addEventListener('click', () => { tip.hide(); select(s.id, true); });
    g.append(hit);
  });
  return g;
}

function legend(items) {
  return h('div', { class: 'legend' }, items.map(([label, color]) => h('span', null, h('i', { style: `background:var(${color})` }), label)));
}

function renderStats() {
  const list = visibleMessages().filter((s) => s.finished_at);
  const t = totalsOf(list);
  const st = $('stats');
  const scopeLabel = S.f.session ? `session ${S.f.session.slice(0, 8)}…` : 'all sessions';
  const tile = (v, l, bad) => h('div', { class: 'tile' + (bad ? ' bad' : '') }, h('div', { class: 'v' }, v), h('div', { class: 'l' }, l));
  const tiles = h('div', { class: 'tiles' },
    tile(t.n, 'requests'), tile(fmtK(t.unc), 'input (uncached)'), tile(fmtK(t.cr), 'cache read'), tile(fmtK(t.cw), 'cache write'),
    tile(fmtK(t.out), 'output'), tile(fmtCost(t.cost), 'cost (est.)'), tile(fmtWall(t.wall), 'wall time'), tile(t.errors, 'errors ⚠', t.errors > 0));
  const note = h('div', { class: 'note' }, `Totals for the requests currently shown (${scopeLabel}, current filters). Click any bar or point to open that exchange.`);

  const tokSeries = [
    { label: 'cache read', color: '--s1', get: (s) => s.usage.cache_read },
    { label: 'cache write', color: '--s2', get: (s) => s.usage.cache_write },
    { label: 'input (uncached)', color: '--s3', get: (s) => s.usage.input },
    { label: 'output', color: '--s4', get: (s) => s.usage.output },
  ];
  const tokTip = (s) => `#${s.id}  ${fmtTime(s.started_at)}  L${s.lane}\ncache read   ${fmtK(s.usage.cache_read)}\ncache write  ${fmtK(s.usage.cache_write)}\ninput        ${fmtK(s.usage.input)}\noutput       ${fmtK(s.usage.output)}\ncost         ${fmtCost(s.cost_usd)} est.`;
  const latSeries = [
    { label: 'time to first byte', color: '--s1', get: (s) => s.ttfb_ms || 0 },
    { label: 'rest of duration', color: '--s2', get: (s) => Math.max(0, (s.duration_ms || 0) - (s.ttfb_ms || 0)) },
  ];
  const latTip = (s) => `#${s.id}  ${s.model || ''}\nttfb      ${fmtMs(s.ttfb_ms)}\nduration  ${fmtMs(s.duration_ms)}`;

  // Tool usage
  const tools = new Map();
  for (const s of list) {
    for (const c of s.tool_calls) { const t2 = tools.get(c.name) || { calls: 0, results: 0, errors: 0, size: 0 }; t2.calls++; tools.set(c.name, t2); }
    for (const r of s.tool_results) { const t2 = tools.get(r.name) || { calls: 0, results: 0, errors: 0, size: 0 }; t2.results++; t2.size += r.size; if (r.is_error) t2.errors++; tools.set(r.name, t2); }
  }
  const toolRows = [...tools].sort((a, b) => b[1].calls - a[1].calls);
  const toolTable = h('table', null, h('thead', null, h('tr', null, ['tool', 'calls', 'results', 'errors', 'error rate', 'mean result'].map((x) => h('th', null, x)))),
    h('tbody', null, toolRows.map(([name, v]) => h('tr', null,
      h('td', null, h('a', { title: 'filter the list to this tool', onclick: () => { S.f.tools = [name]; buildFilterLists(); saveHash(); refilter(); } }, KINDS.tool_call.icon + ' ' + name)),
      h('td', null, v.calls), h('td', null, v.results), h('td', { class: v.errors ? 'status-bad' : '' }, v.errors ? '⚠ ' + v.errors : 0),
      h('td', null, v.results ? Math.round(100 * v.errors / v.results) + '%' : '–'),
      h('td', null, v.results ? sizeText(Math.round(v.size / v.results)).split(' · ')[0] : '–')))));

  // Context growth: the largest lane is drawn as a line; other lanes as grey points.
  const laneCount = new Map();
  for (const s of list) { const k = s.session_id + '/' + s.lane; laneCount.set(k, (laneCount.get(k) || 0) + 1); }
  const mainLane = [...laneCount].sort((a, b) => b[1] - a[1])[0]?.[0];
  const inMain = (s) => s.session_id + '/' + s.lane === mainLane;

  const charts = h('div', { class: 'charts' },
    h('div', { class: 'chart' }, h('h4', null, 'Tokens per request'), legend(tokSeries.map((s) => [s.label, s.color])),
      h('div', { class: 'plot' }, list.length ? stackedBars(list, tokSeries, fmtK, tokTip) : h('div', { class: 'note' }, 'no finished requests'))),
    h('div', { class: 'chart' }, h('h4', null, 'Latency per request'), legend(latSeries.map((s) => [s.label, s.color])),
      h('div', { class: 'plot' }, list.length ? stackedBars(list, latSeries, (v) => fmtMs(Math.round(v)), latTip) : h('div', { class: 'note' }, 'no finished requests'))),
    h('div', { class: 'chart' }, h('h4', null, 'Context growth (input tokens incl. cache)'),
      legend([[`largest lane (L${mainLane ? mainLane.split('/').pop() : '?'})`, '--s1'], ['other lanes', '--muted']]),
      h('div', { class: 'plot' }, list.length ? lineChart(list, (s) => totalIn(s.usage), inMain,
        (s) => `#${s.id}  L${s.lane}\ncontext  ${fmtK(totalIn(s.usage))} tokens`) : h('div', { class: 'note' }, 'no finished requests')),
      h('div', { class: 'note' }, 'A sudden drop in the line usually means the conversation was compacted.')),
    h('div', { class: 'chart' }, h('h4', null, 'Tool usage'), toolRows.length ? toolTable : h('div', { class: 'note' }, 'no tool calls')));
  st.replaceChildren(tiles, note, charts);
}

// ------------------------------------------------------------------ live updates
function applyEvent(type, data) {
  const isNew = !S.ex.has(data.id);
  const content = data.content;
  delete data.content;
  S.ex.set(data.id, data);
  upsertRow(data, isNew && type === 'exchange.started');
  scheduleFilterLists();
  updateTotals();
  if (!$('stats').hidden) scheduleStats();
  const cached = S.detailCache.get(data.id);
  if (cached) cached._stale = true;
  if (data.id === S.sel) {
    if ((data.state === 'streaming' || data.state === 'pending') && S.detail && content) {
      S.detail.response.content = content;
      Object.assign(S.detail, data);
      const box = document.getElementById('reply-live');
      if (box && (S.tab === 'overview' || S.tab === 'reply')) {
        fillReply(box, content, S.detail.response, data, { id: data.id, summary: data, pairedResults: S.detail.paired_results, pairedCalls: S.detail.paired_calls });
      }
    } else if (type !== 'exchange.updated' || data.state !== 'streaming') {
      scheduleDetailRefresh(data.id);
    }
  }
  if (S.f.q && type === 'exchange.finished') runSearch();
}
let detailTimer = null;
function scheduleDetailRefresh(id) {
  clearTimeout(detailTimer);
  detailTimer = setTimeout(async () => {
    if (S.sel !== id) return;
    await fetchDetail(id);
    if (S.sel === id && S.tab !== 'raw') renderDetail();
  }, 250);
}

function setLive(state, text) {
  const el = $('live');
  el.className = 'live ' + state;
  el.querySelector('b').textContent = text;
}

async function resync() {
  try {
    const list = await fetch('/api/exchanges').then((r) => r.json());
    const seen = new Set();
    for (const s of list) {
      seen.add(s.id);
      S.ex.set(s.id, s);
      upsertRow(s, false);
    }
    for (const id of [...S.ex.keys()]) if (!seen.has(id)) { S.ex.delete(id); S.rows.get(id)?.remove(); S.rows.delete(id); }
    $('list-empty').hidden = S.ex.size > 0;
    buildFilterLists(); refilter();
    if (S.sel != null && S.ex.has(S.sel)) { S.detailCache.delete(S.sel); select(S.sel, true); }
  } catch (_) { /* server down; EventSource will retry */ }
}

function connect() {
  const es = new EventSource('/events');
  es.onopen = () => { S.connected = true; setLive(S.paused ? 'paused' : 'on', S.paused ? 'paused' : 'live'); resync(); };
  es.onerror = () => { S.connected = false; setLive('off', 'disconnected'); };
  for (const type of ['exchange.started', 'exchange.updated', 'exchange.finished']) {
    es.addEventListener(type, (e) => {
      const data = JSON.parse(e.data);
      if (S.paused) { S.queued.push([type, data]); $('b-pause').textContent = `resume ▶ (${S.queued.length})`; return; }
      applyEvent(type, data);
    });
  }
}

// ------------------------------------------------------------------ wiring
function init() {
  loadHash();
  buildKindsMenu();
  applyHidden();
  $('list').addEventListener('click', (e) => { const row = e.target.closest('.row'); if (row) select(+row.dataset.id); });
  $('list').addEventListener('scroll', () => { if ($('list').scrollTop < 4 && S.newCount) { S.newCount = 0; showPill(); } });
  $('newpill').addEventListener('click', () => { $('list').scrollTop = 0; S.newCount = 0; showPill(); });
  const onSel = (key) => (e) => { S.f[key] = e.target.value; if (key === 'session') { S.f.lane = ''; buildFilterLists(); } saveHash(); refilter(); };
  $('f-session').addEventListener('change', onSel('session'));
  $('f-lane').addEventListener('change', onSel('lane'));
  $('f-model').addEventListener('change', onSel('model'));
  $('f-errors').addEventListener('change', (e) => { S.f.errors = e.target.checked; saveHash(); refilter(); });
  $('f-other').addEventListener('change', (e) => { S.f.other = e.target.checked; saveHash(); refilter(); });
  $('f-q').addEventListener('input', (e) => { S.f.q = e.target.value; saveHash(); runSearch(); });
  $('f-scope').addEventListener('change', (e) => { S.f.scope = e.target.checked ? 'all' : ''; saveHash(); runSearch(); });
  $('b-stats').addEventListener('click', () => toggleStats());
  $('b-pause').addEventListener('click', () => {
    S.paused = !S.paused;
    $('b-pause').textContent = S.paused ? 'resume ▶' : 'pause ‖';
    $('b-pause').classList.toggle('on', S.paused);
    if (!S.paused) { const q = S.queued; S.queued = []; for (const [t, d] of q) applyEvent(t, d); }
    setLive(S.connected ? (S.paused ? 'paused' : 'on') : 'off', S.connected ? (S.paused ? 'paused' : 'live') : 'disconnected');
  });
  document.addEventListener('click', (e) => {
    for (const m of document.querySelectorAll('details.menu[open]')) if (!m.contains(e.target)) m.open = false;
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    if (e.key === 'j' || e.key === 'k') {
      const rows = [...$('list').children].filter((r) => !r.hidden);
      const i = rows.findIndex((r) => +r.dataset.id === S.sel);
      const next = rows[e.key === 'j' ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1)];
      if (next) select(+next.dataset.id, true);
    }
    if (e.key === '/') { e.preventDefault(); $('f-q').focus(); }
  });
  fetch('/api/info').then((r) => r.json()).then((info) => {
    S.info = info;
    $('hint-cmd').textContent = `ANTHROPIC_BASE_URL=http://localhost:${info.proxy_port} claude`;
  }).catch(() => {});
  if (S.f.q) runSearch();
  connect();
}
init();
