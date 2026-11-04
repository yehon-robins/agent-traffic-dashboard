/* Agent Traffic dashboard. Vanilla JS, no dependencies (D2). Hebrew, RTL interface (SPEC 6.8). */
'use strict';

// ------------------------------------------------------------------ interface strings, one table per language (SPEC 6.8)
// Captured content (prompts, replies, tool names, JSON, model IDs, stop_reason values) is never translated.
const STRINGS = {};
STRINGS.he = {
  kinds: {
    system: 'מערכת', tools: 'כלים', user: 'משתמש', assistant: 'תשובת המודל',
    tool_call: 'קריאה לכלי', tool_result: 'תוצאת כלי', thinking: 'חשיבה', error: 'שגיאה',
  },
  roles: { user: 'משתמש', assistant: 'מודל' },
  laneRoles: { agent: 'סוכן', side: 'צדדי' },
  states: { pending: 'ממתין', streaming: 'בהזרמה', done: 'הושלם', error: 'שגיאה', aborted: 'נקטע' },
  anomalies: {
    http_error: 'שגיאת HTTP', stream_error: 'שגיאה בהזרמה', aborted: 'החיבור נקטע', parse_error: 'שגיאת פענוח',
    tool_error: 'שגיאת כלי', unanswered: 'קריאה ללא תוצאה', max_tokens: 'הגעה ל־max_tokens',
    system_changed: 'הנחיות המערכת השתנו', tools_changed: 'סט הכלים השתנה',
  },
  tabs: { overview: 'סקירה', request: 'בקשה', reply: 'תשובה', composition: 'הרכב', changes: 'שינויים', raw: 'גולמי' },
  comp: {
    notCalibrated: 'עדיין לא כויל: התשובה טרם הסתיימה, ולכן גם הסכום הוא הערכה.',
    noUsage: 'ה־API לא דיווח על שימוש בטוקנים (הבקשה נכשלה), לכן כל המספרים כאן הם הערכה בלבד.',
    oldServer: 'השרת לא שלח נתוני הרכב. כנראה שהפרוקסי הופעל לפני שהתכונה נוספה: עצרו אותו (Ctrl+C) והפעילו מחדש את python3 proxy.py.',
    totalExact: 'סך הקלט', exactNote: 'מדויק, כפי שדווח מה־API', estNote: 'הערכה',
    note: 'מספר הטוקנים של כל חלק הוא הערכה (≈) שכוילה כך שהסכום שווה בדיוק לסך שדווח. לחיצה על חלק מעבירה לבלוק שלו בלשונית "בקשה".',
    bySource: 'לפי מקור', allSegs: 'כל החלקים',
    cols: ['מקור', 'מיקום', 'טוקנים', 'מהקלט', 'מטמון'],
    parts: (n) => n === 1 ? 'חלק אחד' : `${n} חלקים`,
    more: (n) => `הצגת עוד ${n}`,
    goto: 'מעבר לבלוק',
    cache: { read: 'מהמטמון', write: 'נכתב למטמון', none: 'ללא מטמון', mixed: 'חלקי' },
    loc: { tool: (n) => `הגדרת כלי ${n}`, sys: (n) => `בלוק מערכת ${n}`, msg: (m, b) => `הודעה ${m}, חלק ${b}`, chars: (a, b) => `תווים ${a}–${b}` },
    chart: 'הרכב הפרומפט לאורך זמן',
    changes: 'הרכב הפרומפט',
    unchangedList: 'ללא שינוי: ',
    noComp: 'אין נתוני הרכב לבקשה זו.',
    cacheRead: 'קריאה ממטמון', cacheWrite: 'כתיבה למטמון', uncached: 'ללא מטמון',
  },
  ui: {
    brand: 'תעבורת סוכנים', liveTitle: 'חיבור לפרוקסי', connecting: 'מתחבר…',
    session: 'סשן', lane: 'מסלול', model: 'מודל', kindsMenu: 'סוגים', kindsHint: 'הצגה או הסתרה של כל סוג בתצוגת הפרטים.',
    toolMenu: 'כלי', toolsHint: 'רק בקשות שקוראות לכלים האלה או מחזירות את תוצאותיהם.',
    errorsOnly: 'שגיאות בלבד', otherTraffic: 'תעבורה אחרת', otherTitle: 'count_tokens,‏ HEAD,‏ GET ותעבורה שאינה Messages',
    searchPh: 'חיפוש…', scopeLabel: 'כולל מערכת/כלים', scopeTitle: 'חיפוש גם בהנחיות המערכת ובהגדרות הכלים',
    noTraffic: 'אין עדיין תעבורה', listLabel: 'בקשות', waiting: 'ממתין לתעבורה…', pointAgent: 'הפנו את הסוכן אל הפרוקסי:',
    resizerLabel: 'שינוי רוחב החלוניות', selectHint: 'בחרו בקשה מהרשימה.', langTitle: 'Switch to English',
    cbar: 'פס הרכב', cbarTitle: 'פס צבעוני בכל שורה: מאילו מקורות הורכב הפרומפט',
  },
  all: 'הכול',
  copy: 'העתקה', copied: 'הועתק',
  collapse: 'כיווץ',
  showAll: (lines, chars) => `הצגת הכול (${lines} שורות, ${chars} תווים)`,
  size: (chars, tok) => `${chars} תווים · ~${tok} טוקנים`,
  items: (n) => `[ ${n} פריטים ]`, keys: (n) => `{ ${n} מפתחות }`,
  badToolInput: 'לא ניתן לפענח את קלט הכלי',
  renderMd: 'הצגה כ־Markdown',
  expandAll: 'הרחבת הכול', collapseAll: 'כיווץ הכול',
  cacheTitle: 'נקודת שמירה במטמון הפרומפט: כל מה שמעליה נשמר במטמון',
  cacheMark: 'נקודת מטמון',
  injected: 'הוזרק על ידי ה־harness',
  redactedThinking: '[חשיבה מוסתרת]',
  receivingInput: 'מקבל קלט…',
  resultIn: (id) => `התוצאה ב־#${id}`,
  calledIn: (id) => `נקרא ב־#${id}`,
  neverResult: 'לא התקבלה תוצאה',
  awaitingResult: 'ממתין לתוצאה…',
  message: (n) => `הודעה ${n}`,
  echoOf: (id) => `· הד של התשובה של #${id}`,
  streaming: 'בהזרמה…',
  toolCallTitle: 'קריאה לכלי',
  toolErrTitle: 'תוצאת כלי עם is_error',
  rewritten: 'היסטוריה שוכתבה',
  rewrittenTitle: 'ההודעות הקודמות שונות מאלה שבבקשה הקודמת',
  laneTitle: (lane, role, sess) => `מסלול ${lane} (${role}) · סשן ${sess}`,
  newRows: (n) => `${n} חדשות`,
  reqCount: (n) => `${n} בקשות`,
  noToolCallsYet: 'אין עדיין קריאות לכלים',
  clear: 'ניקוי',
  noMatching: 'אין בקשות תואמות',
  noTraffic: 'אין עדיין תעבורה',
  totals: {
    requests: (n) => n === 1 ? ' בקשה · ' : ' בקשות · ', in: ' נכנס (קריאה ממטמון ', write: ', כתיבה ', out: ' יוצא · ', est: ' הערכה · ',
    errors: (n) => ` ${n} ${n === 1 ? 'שגיאה' : 'שגיאות'}`,
  },
  notLoaded: (id) => `#${id} לא נטען.`,
  inTok: 'נכנס', outTok: 'יוצא', uncached: 'ללא מטמון', cacheRead: 'קריאה ממטמון', write: 'כתיבה',
  est: 'הערכה', priceEntry: (src) => `רשומה במחירון: ${src}`,
  ttfb: 'זמן לבית ראשון', stop: 'עצירה', lane: 'מסלול', session: 'סשן',
  kindbarTitle: 'לחצו על סוג כדי להסתיר או להציג אותו',
  rewrittenBanner: (id) => `ההודעות הקודמות שונות מאלה שב־#${id} (דחיסה, עריכה או שיחה אחרת). פרטים בלשונית "שינויים".`,
  renderError: 'שגיאת תצוגה',
  rel: {
    append: (prev, added, total, echo) => `נוספו אחרי #${prev}: ${added} הודעות חדשות מתוך ${total}`
      + (echo != null ? ` (הודעה ${echo} היא הד של התשובה של #${prev} ואינה מוצגת שוב).` : '.'),
    rewritten: (prev, from, to) => `ההיסטוריה שוכתבה ביחס ל־#${prev}; מוצג תור המשתמש האחרון (הודעות ${from}–${to}).`,
    independent: (prev) => `קריאה עצמאית במסלול הזה (אין היסטוריה משותפת עם #${prev}).`,
    firstPart: (lane, from, to) => `הבקשה הראשונה במסלול ${lane}; מוצג תור המשתמש האחרון (הודעות ${from}–${to} מתוך ${to}).`,
    firstAll: (lane, n) => `הבקשה הראשונה במסלול ${lane}: כל ${n} ההודעות.`,
  },
  notParsed: 'לא פוענח',
  notParsedMsg: 'לא ניתן היה לפענח את הבקשה. ראו את לשונית "גולמי".',
  notParsedOther: 'רק פורמט Anthropic Messages מפוענח (D4). הבקשה והתשובה המלאות נמצאות בלשונית "גולמי".',
  newInRequest: 'חדש בבקשה זו',
  messagesN: (n) => `${n} הודעות`,
  nothingNewRetry: (id) => `אין שום דבר חדש: אותה שיחה כמו ב־#${id} נשלחה שוב (בדרך כלל ניסיון חוזר).`,
  nothingNew: 'אין שום דבר חדש',
  reply: 'תשובה',
  seeRaw: 'גוף התשובה מופיע בלשונית "גולמי".',
  waitingReply: 'ממתין לתשובה…',
  noContent: 'אין תוכן',
  paramsHeaders: 'פרמטרים וכותרות',
  reqHeaders: 'כותרות הבקשה (סודות מוסתרים)',
  system: 'מערכת',
  blocks: (n) => `${n} בלוקים`,
  block: (n) => `בלוק ${n}`,
  noSystem: 'אין הנחיות מערכת',
  toolsN: (n) => `כלים (${n})`,
  noTools: 'לא הוצעו כלים',
  convSoFar: (n) => `השיחה עד כה (${n} הודעות)`,
  none: 'אין',
  newMsgs: (n) => `הודעות חדשות (${n})`,
  usageTiming: 'שימוש ותזמון',
  kv: {
    input: 'קלט (ללא מטמון)', cacheRead: 'קריאה ממטמון', cacheWrite: 'כתיבה למטמון', output: 'פלט', cost: 'עלות (הערכה)',
    started: 'התחלה', ttfb: 'זמן לבית ראשון', duration: 'משך', state: 'מצב', status: 'סטטוס',
  },
  costEntry: (cost, src) => `${cost} — רשומה במחירון "${src}"`,
  usageRaw: 'השימוש כפי שהוחזר מה־API',
  messageObj: 'הודעה',
  replyHeaders: 'כותרות התשובה',
  firstRequest: 'בקשה ראשונה',
  firstNothing: (lane) => `הבקשה הראשונה במסלול ${lane}: אין למה להשוות.`,
  comparedWith: 'בהשוואה ל־',
  comparedTail: (lane) => `, הבקשה הקודמת במסלול ${lane}.`,
  unchanged: 'ללא שינוי',
  unchangedMsg: 'הנחיות המערכת והכלים לא השתנו.',
  sysChanged: 'הנחיות המערכת השתנו',
  sysStructOnly: 'השתנו רק מבנה הבלוקים או סימוני המטמון; הטקסט זהה.',
  toolsChanged: 'סט הכלים השתנה',
  toolOps: { added: 'נוספו', removed: 'הוסרו', changed: 'השתנו' },
  params: 'פרמטרים',
  paramsSame: 'הפרמטרים model, max_tokens, thinking ו־temperature לא השתנו',
  messages: 'הודעות',
  normalAppend: (kept, added, echo, prev) => `הוספה רגילה: ${kept} הודעות קודמות נשארו ללא שינוי, ${added} נוספו`
    + (echo != null ? ` (הודעה ${echo} היא התשובה של #${prev}).` : '.'),
  noShared: 'אין היסטוריה משותפת עם הבקשה הקודמת במסלול הזה.',
  opEqual: (n, from, to) => `= ${n} הודעות ללא שינוי (הודעות ${from}–${to})`,
  opModified: (role, a, b) => `~ שונתה: הודעת ${role} ${a} ← ${b}`,
  opAdded: (role, n) => `+ נוספה: הודעת ${role} ${n}`,
  opRemoved: (role, n) => `− הוסרה: הודעת ${role} ${n}`,
  loadingRaw: 'טוען נתונים גולמיים…',
  request: 'בקשה',
  rawBodyNote: 'גוף הבקשה (סודות נמצאים רק בכותרות, והן מוסתרות)',
  empty: '(ריק)',
  stats: 'סטטיסטיקה',
  allSessions: 'כל הסשנים',
  sessionScope: (s) => `סשן ${s}…`,
  tiles: {
    requests: 'בקשות', input: 'קלט (ללא מטמון)', cacheRead: 'קריאה ממטמון', cacheWrite: 'כתיבה למטמון', output: 'פלט',
    cost: 'עלות (הערכה)', wall: 'זמן כולל', errors: 'שגיאות',
  },
  statsNote: (scope) => `סיכומים לבקשות המוצגות כעת (${scope}, לפי המסננים הנוכחיים). לחיצה על עמודה או נקודה פותחת את הבקשה.`,
  series: {
    cacheRead: 'קריאה ממטמון', cacheWrite: 'כתיבה למטמון', input: 'קלט (ללא מטמון)', output: 'פלט',
    ttfb: 'זמן לבית ראשון', rest: 'יתרת המשך',
  },
  tipCost: 'עלות (הערכה)', tipDuration: 'משך', tipContext: 'הקשר', tokens: 'טוקנים',
  toolTable: ['כלי', 'קריאות', 'תוצאות', 'שגיאות', 'שיעור שגיאות', 'תוצאה ממוצעת'],
  filterToTool: 'סינון הרשימה לכלי הזה',
  charts: { tokens: 'טוקנים לבקשה', latency: 'זמן תגובה לבקשה', context: 'גידול ההקשר (טוקני קלט כולל מטמון)', tools: 'שימוש בכלים' },
  largestLane: (l) => `המסלול הגדול ביותר (${l})`, otherLanes: 'מסלולים אחרים',
  noFinished: 'אין בקשות שהסתיימו',
  compactionNote: 'ירידה חדה בקו מעידה בדרך כלל על דחיסה של השיחה.',
  noToolCalls: 'אין קריאות לכלים',
  live: 'חי', paused: 'מושהה', disconnected: 'מנותק',
  pause: 'השהיה', resume: 'המשך', pauseTitle: 'השהיית עדכונים חיים',
  theme: { auto: 'ערכת נושא: לפי המערכת', light: 'ערכת נושא: בהירה', dark: 'ערכת נושא: כהה' },
};
STRINGS.en = {
  kinds: {
    system: 'System', tools: 'Tools', user: 'User', assistant: 'Assistant',
    tool_call: 'Tool call', tool_result: 'Tool result', thinking: 'Thinking', error: 'Error',
  },
  roles: { user: 'user', assistant: 'assistant' },
  laneRoles: { agent: 'agent', side: 'side' },
  states: { pending: 'pending', streaming: 'streaming', done: 'done', error: 'error', aborted: 'aborted' },
  anomalies: {
    http_error: 'HTTP error', stream_error: 'stream error', aborted: 'aborted', parse_error: 'parse error',
    tool_error: 'tool error', unanswered: 'unanswered tool call', max_tokens: 'hit max_tokens',
    system_changed: 'system prompt changed', tools_changed: 'tool set changed',
  },
  tabs: { overview: 'Overview', request: 'Request', reply: 'Reply', composition: 'Composition', changes: 'Changes', raw: 'Raw' },
  comp: {
    notCalibrated: 'Not calibrated yet: the reply has not finished, so the total is an estimate too.',
    noUsage: 'The API reported no token usage (the request failed), so every number here is an estimate only.',
    oldServer: 'The server sent no composition data. The proxy was probably started before this feature was added: stop it (Ctrl+C) and run python3 proxy.py again.',
    totalExact: 'Input total', exactNote: 'exact, as reported by the API', estNote: 'estimate',
    note: 'Each part\'s token count is an estimate (≈), calibrated so they add up exactly to the reported total. Click a part to jump to its block in the Request tab.',
    bySource: 'by source', allSegs: 'all parts',
    cols: ['source', 'location', 'tokens', 'of input', 'cache'],
    parts: (n) => n === 1 ? '1 part' : `${n} parts`,
    more: (n) => `show ${n} more`,
    goto: 'jump to block',
    cache: { read: 'cached', write: 'cache write', none: 'uncached', mixed: 'partly' },
    loc: { tool: (n) => `tool definition ${n}`, sys: (n) => `system block ${n}`, msg: (m, b) => `message ${m}, part ${b}`, chars: (a, b) => `chars ${a}–${b}` },
    chart: 'Prompt composition over time',
    changes: 'Prompt composition',
    unchangedList: 'unchanged: ',
    noComp: 'No composition data for this request.',
    cacheRead: 'cache read', cacheWrite: 'cache write', uncached: 'uncached',
  },
  ui: {
    brand: 'Agent Traffic', liveTitle: 'connection to the proxy', connecting: 'connecting…',
    session: 'session', lane: 'lane', model: 'model', kindsMenu: 'kinds', kindsHint: 'Show or hide each kind in the detail view.',
    toolMenu: 'tool', toolsHint: 'Only exchanges that call, or return results for, these tools.',
    errorsOnly: 'errors only', otherTraffic: 'other traffic', otherTitle: 'count_tokens, HEAD, GET and non-Messages traffic',
    searchPh: 'search…', scopeLabel: '+system/tools', scopeTitle: 'also search the system prompt and tool definitions',
    noTraffic: 'no traffic yet', listLabel: 'exchanges', waiting: 'Waiting for traffic…', pointAgent: 'Point the agent at the proxy:',
    resizerLabel: 'resize the panes', selectHint: 'Select an exchange from the list.', langTitle: 'החלפה לעברית',
    cbar: 'composition bar', cbarTitle: 'a colored bar on every row: which sources the prompt was built from',
  },
  all: 'all',
  copy: 'copy', copied: 'copied',
  collapse: 'collapse',
  showAll: (lines, chars) => `show all (${lines} lines, ${chars} chars)`,
  size: (chars, tok) => `${chars} chars · ~${tok} tok`,
  items: (n) => `[ ${n} items ]`, keys: (n) => `{ ${n} keys }`,
  badToolInput: 'could not parse tool input',
  renderMd: 'render Markdown',
  expandAll: 'expand all', collapseAll: 'collapse all',
  cacheTitle: 'prompt-cache breakpoint: everything above is cached',
  cacheMark: 'cache breakpoint',
  injected: 'injected by harness',
  redactedThinking: '[redacted thinking]',
  receivingInput: 'receiving input…',
  resultIn: (id) => `result in #${id}`,
  calledIn: (id) => `called in #${id}`,
  neverResult: 'never received a result',
  awaitingResult: 'awaiting result…',
  message: (n) => `message ${n}`,
  echoOf: (id) => `· echo of #${id}'s reply`,
  streaming: 'streaming…',
  toolCallTitle: 'tool call',
  toolErrTitle: 'tool result with is_error',
  rewritten: 'history rewritten',
  rewrittenTitle: 'earlier messages differ from the previous request',
  laneTitle: (lane, role, sess) => `lane ${lane} (${role}) · session ${sess}`,
  newRows: (n) => `${n} new`,
  reqCount: (n) => `${n} req`,
  noToolCallsYet: 'no tool calls yet',
  clear: 'clear',
  noMatching: 'no matching requests',
  noTraffic: 'no traffic yet',
  totals: {
    requests: (n) => n === 1 ? ' request · ' : ' requests · ', in: ' in (cache read ', write: ', write ', out: ' out · ', est: ' est. · ',
    errors: (n) => ` ${n} error${n === 1 ? '' : 's'}`,
  },
  notLoaded: (id) => `#${id} is not loaded.`,
  inTok: 'in', outTok: 'out', uncached: 'uncached', cacheRead: 'cache read', write: 'write',
  est: 'est.', priceEntry: (src) => `price table entry: ${src}`,
  ttfb: 'ttfb', stop: 'stop', lane: 'lane', session: 'session',
  kindbarTitle: 'click a kind to hide or show it',
  rewrittenBanner: (id) => `Earlier messages differ from #${id} (compaction, edits, or a different conversation). See the Changes tab.`,
  renderError: 'render error',
  rel: {
    append: (prev, added, total, echo) => `Appended after #${prev}: ${added} new message(s) of ${total}`
      + (echo != null ? ` (message ${echo} echoes #${prev}'s reply and is not repeated here).` : '.'),
    rewritten: (prev, from, to) => `History rewritten relative to #${prev}; showing the trailing user turn (messages ${from}–${to}).`,
    independent: (prev) => `An independent call in this lane (no shared history with #${prev}).`,
    firstPart: (lane, from, to) => `First request in lane ${lane}; showing the trailing user turn (messages ${from}–${to} of ${to}).`,
    firstAll: (lane, n) => `First request in lane ${lane}: all ${n} message(s).`,
  },
  notParsed: 'not parsed',
  notParsedMsg: 'The request could not be parsed. See the Raw tab.',
  notParsedOther: 'Only the Anthropic Messages format is parsed (D4). The full request and reply are in the Raw tab.',
  newInRequest: 'New in this request',
  messagesN: (n) => `${n} message(s)`,
  nothingNewRetry: (id) => `Nothing new: the same conversation as #${id} was sent again (usually a retry).`,
  nothingNew: 'nothing new',
  reply: 'Reply',
  seeRaw: 'See the Raw tab for the reply body.',
  waitingReply: 'waiting for the reply…',
  noContent: 'no content',
  paramsHeaders: 'Parameters & headers',
  reqHeaders: 'Request headers (secrets redacted)',
  system: 'System',
  blocks: (n) => `${n} block(s)`,
  block: (n) => `block ${n}`,
  noSystem: 'no system prompt',
  toolsN: (n) => `Tools (${n})`,
  noTools: 'no tools offered',
  convSoFar: (n) => `Conversation so far (${n} messages)`,
  none: 'none',
  newMsgs: (n) => `New message(s) (${n})`,
  usageTiming: 'Usage & timing',
  kv: {
    input: 'input (uncached)', cacheRead: 'cache read', cacheWrite: 'cache write', output: 'output', cost: 'cost (est.)',
    started: 'started', ttfb: 'time to first byte', duration: 'duration', state: 'state', status: 'status',
  },
  costEntry: (cost, src) => `${cost} — price entry "${src}"`,
  usageRaw: 'usage as returned by the API',
  messageObj: 'message',
  replyHeaders: 'Reply headers',
  firstRequest: 'first request',
  firstNothing: (lane) => `First request in lane ${lane}: nothing to compare.`,
  comparedWith: 'Compared with ',
  comparedTail: (lane) => `, the previous request in lane ${lane}.`,
  unchanged: 'unchanged',
  unchangedMsg: 'System prompt and tools are unchanged.',
  sysChanged: 'System prompt changed',
  sysStructOnly: 'Only block structure or cache markers changed; the text is identical.',
  toolsChanged: 'Tool set changed',
  toolOps: { added: 'added', removed: 'removed', changed: 'changed' },
  params: 'Parameters',
  paramsSame: 'model, max_tokens, thinking and temperature unchanged',
  messages: 'Messages',
  normalAppend: (kept, added, echo, prev) => `Normal append: ${kept} earlier messages kept unchanged, ${added} added`
    + (echo != null ? ` (message ${echo} is #${prev}'s reply).` : '.'),
  noShared: 'No shared history with the previous request in this lane.',
  opEqual: (n, from, to) => `= ${n} message(s) unchanged (messages ${from}–${to})`,
  opModified: (role, a, b) => `~ modified: ${role} message ${a} → ${b}`,
  opAdded: (role, n) => `+ added: ${role} message ${n}`,
  opRemoved: (role, n) => `− removed: ${role} message ${n}`,
  loadingRaw: 'loading raw…',
  request: 'Request',
  rawBodyNote: 'body (secrets are only ever in headers, which are redacted)',
  empty: '(empty)',
  stats: 'Stats',
  allSessions: 'all sessions',
  sessionScope: (s) => `session ${s}…`,
  tiles: {
    requests: 'requests', input: 'input (uncached)', cacheRead: 'cache read', cacheWrite: 'cache write', output: 'output',
    cost: 'cost (est.)', wall: 'wall time', errors: 'errors',
  },
  statsNote: (scope) => `Totals for the requests currently shown (${scope}, current filters). Click any bar or point to open that exchange.`,
  series: {
    cacheRead: 'cache read', cacheWrite: 'cache write', input: 'input (uncached)', output: 'output',
    ttfb: 'time to first byte', rest: 'rest of duration',
  },
  tipCost: 'cost (est.)', tipDuration: 'duration', tipContext: 'context', tokens: 'tokens',
  toolTable: ['tool', 'calls', 'results', 'errors', 'error rate', 'mean result'],
  filterToTool: 'filter the list to this tool',
  charts: { tokens: 'Tokens per request', latency: 'Latency per request', context: 'Context growth (input tokens incl. cache)', tools: 'Tool usage' },
  largestLane: (l) => `largest lane (${l})`, otherLanes: 'other lanes',
  noFinished: 'no finished requests',
  compactionNote: 'A sudden drop in the line usually means the conversation was compacted.',
  noToolCalls: 'no tool calls',
  live: 'live', paused: 'paused', disconnected: 'disconnected',
  pause: 'pause', resume: 'resume', pauseTitle: 'pause live updates',
  theme: { auto: 'theme: follow the OS', light: 'theme: light', dark: 'theme: dark' },
};

/* The active table. A key missing in one language falls back to the other, never to a blank. */
function mergeStrings(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? mergeStrings(base[k], v) : v;
  }
  return out;
}
const LANGS = ['he', 'en'];
let LANG = 'he';
let T = STRINGS.he;

// ------------------------------------------------------------------ kinds: one color, icon, label each
const KINDS = Object.fromEntries(Object.keys(STRINGS.he.kinds).map((k) => [k, { icon: k, get label() { return T.kinds[k]; } }]));
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
  f: { session: '', lane: '', model: '', tools: [], errors: false, other: false, cbar: false, q: '', scope: '', hide: [] },
  srcMap: new Map(),       // prompt sources (SPEC 6.10): id -> {id, label: {he, en}}, from /api/info
  srcOrder: [],
  compMode: 'source',
  compOpen: new Set(),
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
const NS = 'http://www.w3.org/2000/svg';

/* An icon from the inline SVG sprite in index.html. `flip` mirrors direction-aware icons in RTL. */
function icon(name, cls) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('class', 'ic' + (cls ? ' ' + cls : ''));
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(NS, 'use');
  u.setAttribute('href', '#i-' + name);
  s.append(u);
  return s;
}
/* Numbers, IDs and technical tokens inside Hebrew text: isolate them so they never come out scrambled. */
const ltr = (text, cls) => h('bdi', { class: 'ltr' + (cls ? ' ' + cls : ''), dir: 'ltr' }, text);

// ------------------------------------------------------------------ formatting (he-IL)
let LOCALE = 'he-IL';
const fmtK = (n) => n == null ? '–' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M'
  : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : new Intl.NumberFormat(LOCALE).format(n);
const fmtMs = (ms) => ms == null ? '' : ms < 1000 ? ms + 'ms' : ms < 60000 ? (ms / 1000).toFixed(1) + 's'
  : Math.floor(ms / 60000) + 'm' + String(Math.round(ms % 60000 / 1000)).padStart(2, '0') + 's';
const fmtCost = (c) => c == null ? '' : '$' + (c >= 10 ? c.toFixed(1) : c >= 0.995 ? c.toFixed(2) : c.toFixed(3));
let timeFmt, fullFmt, relFmt;
function setLocale(lang) {
  LOCALE = lang === 'en' ? 'en-US' : 'he-IL';
  timeFmt = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  fullFmt = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'medium' });
  relFmt = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
}
setLocale('he');
const fmtTime = (t) => t ? timeFmt.format(new Date(t * 1000)) : '';
const fmtFull = (t) => t ? fullFmt.format(new Date(t * 1000)) : '';
const fmtWall = (s) => s < 60 ? Math.round(s) + 's' : s < 3600 ? Math.round(s / 60) + 'm' : (s / 3600).toFixed(1) + 'h';
function rel(t) {
  const d = Date.now() / 1000 - t;
  if (d < 60) return relFmt.format(-Math.round(d), 'second');
  if (d < 3600) return relFmt.format(-Math.round(d / 60), 'minute');
  if (d < 86400) return relFmt.format(-Math.round(d / 3600), 'hour');
  return relFmt.format(-Math.round(d / 86400), 'day');
}
const timeEl = (t) => h('time', { 'data-t': t, dir: 'ltr', text: fmtTime(t) });
const sizeText = (chars) => T.size(fmtK(chars), fmtK(Math.round(chars / 4)));
const totalIn = (u) => (u.input || 0) + (u.cache_read || 0) + (u.cache_write || 0);
const isErr = (s) => s.anomalies.some((a) => a.level === 'error');
const isWarn = (s) => s.anomalies.length > 0;
const stateText = (st) => T.states[st] || st;
const roleText = (r) => T.roles[r] || r;
const laneRoleText = (r) => T.laneRoles[r] || r;

function kindBadge(kind, mini) {
  const k = KINDS[kind] || { icon: 'other', label: kind };
  return h('span', { class: `kb k-${kind}${mini ? ' mini' : ''}`, title: k.label },
    icon(k.icon), mini ? null : k.label);
}

document.addEventListener('mouseover', (e) => {
  const t = e.target.closest && e.target.closest('time[data-t]');
  if (t) t.title = fmtFull(+t.dataset.t) + ' · ' + rel(+t.dataset.t);
});

// ------------------------------------------------------------------ generic content views
function copyBtn(get) {
  const b = h('button', {
    class: 'btn tiny', title: T.copy, onclick: (e) => {
      e.preventDefault(); e.stopPropagation();
      const text = typeof get === 'function' ? get() : get;
      const done = () => { b.replaceChildren(icon('check'), T.copied); setTimeout(() => b.replaceChildren(icon('copy'), T.copy), 900); };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
      else fallbackCopy(text, done);
    },
  }, icon('copy'), T.copy);
  return b;
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
  // Prose follows its own direction; code is always LTR (SPEC 6.8).
  const pre = h('pre', { class: cls, dir: cls === 'txt' ? 'auto' : 'ltr' });
  wrap.append(pre);
  const long = lines.length > LONG_LINES || text.length > LONG_CHARS;
  const q = S.f.q && S.f.q.toLowerCase();
  if (!long || (q && text.toLowerCase().includes(q))) {
    pre.textContent = text;
    if (long) wrap.append(h('button', { class: 'btn tiny more', onclick: () => { pre.textContent = preview(); btn(); } }, T.collapse));
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
        wrap.append(h('button', { class: 'btn tiny more', onclick: () => { pre.textContent = preview(); btn(); } }, T.collapse));
        highlight(wrap);
      },
    }, T.showAll(lines.length, fmtK(text.length))));
  }
  pre.textContent = preview();
  wrap.dataset.long = '1';
  wrap._expand = () => wrap.querySelector('.more')?.click();
  btn();
  return wrap;
}

/* Plain text with a per-block "render Markdown" toggle (D8). */
/* `pieces`: composition segments of this block with char ranges (SPEC 6.10). A block split across
   several sources is shown piece by piece, each boundary marked with its source chip. */
function textBlockBody(text, pieces) {
  const box = h('div');
  let md = false;
  const plain = () => pieces && pieces.length > 1
    ? pieces.map((sg) => h('div', { class: 'piece src', style: `--c:var(--src-${sg.source}, var(--muted))` },
      h('div', { class: 'pcut' }, srcChip(sg)), longText(text.slice(sg.start, sg.end))))
    : longText(text);
  const render = () => { box.replaceChildren(...[].concat(md ? markdown(text) : plain())); highlight(box); };
  render();
  box._toggleMd = (btn) => { md = !md; btn.classList.toggle('on', md); render(); };
  return box;
}

function markdown(src) {
  const out = h('div', { class: 'md', dir: 'auto' });
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
  const root = h('div', { class: 'jv', dir: 'ltr' });
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
  d.append(h('summary', null, arr ? T.items(keys.length) : T.keys(keys.length)));
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
      if (b.dataset.open) { short(); b.textContent = T.showAll(lines, fmtK(s.length)); delete b.dataset.open; }
      else { span.textContent = '"' + s + '"'; b.textContent = T.collapse; b.dataset.open = '1'; highlight(span); }
    },
  }, T.showAll(lines, fmtK(s.length)));
  return h('span', null, span, ' ', b);
}

/* A tool input: code-like strings become code blocks, the rest JSON. */
function toolInputView(input) {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) return jsonView(input);
  if (input._unparsed != null) return h('div', null, h('div', { class: 'errtag' }, T.badToolInput), longText(input._unparsed, 'code'));
  const box = h('div', { class: 'tin', dir: 'ltr' });
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
  if (opts.md) acts.append(h('button', { class: 'btn tiny', title: T.renderMd, onclick: (e) => { e.preventDefault(); e.stopPropagation(); opts.md._toggleMd(e.target); } }, 'MD'));
  if (opts.copy != null) acts.append(copyBtn(opts.copy));
  d.append(h('summary', null, kindBadge(kind), opts.title ? h('span', { class: 'bt' }, opts.title) : null,
    opts.extra || null, opts.size != null ? h('span', { class: 'size' }, sizeText(opts.size)) : null, acts));
  if (typeof body === 'function') {
    let built = false;
    const build = () => { if (!built) { built = true; const b = h('div', { class: 'bb' }, body()); d.append(b); highlight(b); } };
    d.addEventListener('toggle', () => d.open && build());
    d._build = build;
    if (d.open) build();
  } else d.append(h('div', { class: 'bb' }, body));
  return d;
}

function section(title, kind, opts, bodyFn) {
  const d = h('details', { class: `sec${kind ? ' k-' + kind : ''}`, dataset: opts.sec ? { sec: opts.sec } : null });
  if (opts.open) d.open = true;
  const acts = h('span', { class: 'acts' },
    h('button', { class: 'btn tiny', title: T.expandAll, onclick: (e) => { e.preventDefault(); e.stopPropagation(); d.open = true; setTimeout(() => expandAll(d, true)); } }, T.expandAll),
    h('button', { class: 'btn tiny', title: T.collapseAll, onclick: (e) => { e.preventDefault(); e.stopPropagation(); expandAll(d, false); } }, T.collapseAll),
    opts.copy != null ? copyBtn(opts.copy) : null);
  d.append(h('summary', null, kind ? kindBadge(kind) : null, h('h3', null, title),
    opts.size != null ? h('span', { class: 'size' }, sizeText(opts.size)) : null, opts.extra || null, acts));
  let built = false;
  const build = () => { if (!built) { built = true; const b = h('div', { class: 'sb' }, bodyFn()); d.append(b); highlight(b); } };
  d.addEventListener('toggle', () => d.open && build());
  d._build = build;
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
  return h('div', { class: 'cachemark', title: T.cacheTitle },
    T.cacheMark, ' · ', ltr(`${cc.type || ''}${cc.ttl ? ' · ttl ' + cc.ttl : ''}`));
}

function textBlk(kind, text, extra, pieces) {
  const body = textBlockBody(text, pieces);
  return blk(kind, { size: text.length, copy: text, md: body, extra }, body);
}

function blockView(b, role, ctx, ref) {
  const t = b.type;
  if (t === 'text') {
    const e = textBlk(role === 'assistant' ? 'assistant' : 'user', b.text || '',
      role === 'user' && /^\s*<system-reminder>/.test(b.text || '') ? h('span', { class: 'size' }, T.injected) : null,
      piecesOf(ctx, ref));
    return [e, cacheMark(b)];
  }
  if (t === 'thinking' || t === 'redacted_thinking') {
    const text = t === 'thinking' ? (b.thinking || '') : T.redactedThinking;
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
      ? h('div', null, h('div', { class: 'note' }, T.receivingInput), longText(b._partial_json, 'code'))
      : toolInputView(input)];
    if (ctx.pairedResults) {
      const pair = h('div', { class: 'pair' });
      if (res) {
        const text = resultText(res.block || {});
        pair.append(h('div', { class: 'ph' }, kindBadge('tool_result'),
          isErrorRes ? h('span', { class: 'errtag' }, icon('x'), ltr('is_error')) : h('span', { class: 'okt' }, icon('check')),
          h('span', { class: 'size' }, sizeText(text.length)),
          res.exchange_id !== ctx.id ? xlink(res.exchange_id, T.resultIn(res.exchange_id), 'fwd') : null,
          copyBtn(text)));
        pair.append(longText(text, 'code'));
      } else {
        const never = ctx.summary && ctx.summary.anomalies.some((a) => a.code === 'unanswered' && a.msg.includes(b.id));
        pair.append(h('div', { class: 'pending-res' + (never ? ' bad' : '') }, never ? [icon('error'), ' ', T.neverResult] : T.awaitingResult));
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
    extra: h('span', null, b.is_error ? h('span', { class: 'errtag' }, icon('x'), ltr('is_error'), ' ') : null,
      h('span', { class: 'id' }, b.tool_use_id || ''), ' ',
      call && call.exchange_id !== ctx.id ? xlink(call.exchange_id, T.calledIn(call.exchange_id), 'back') : null),
  }, () => {
    const parts = [longText(text, 'code')];
    blocksOf(b.content).filter((x) => x.type !== 'text').forEach((x) => parts.push(h('div', { class: 'note' }, `[${x.type}] ${x.source?.media_type || ''}`)));
    return parts;
  });
}

function messageView(m, index, ctx, extraNote) {
  const role = m.role || '?';
  const card = h('div', { class: `msg role-${role}${extraNote === 'echo' ? ' echo' : ''}` });
  card.append(h('div', { class: 'mh' }, h('span', { class: 'role' }, roleText(role)), T.message(index + 1),
    extraNote === 'echo' ? h('span', null, T.echoOf(ctx.summary.prev_id)) : null));
  const mb = h('div', { class: 'mb' });
  blocksOf(m.content).forEach((b, j) => {
    const ref = `m:${index}:${j}`;
    const els = blockView(b, role, ctx, ref).filter(Boolean);
    if (els[0]) { els[0].dataset.ref = ref; addSourceChips(els[0], ref, ctx); }
    mb.append(...els);
  });
  card.append(mb);
  return card;
}

/* A link to another exchange. 'fwd' points forward in reading direction (left in RTL), 'back' points backward. */
function xlink(id, label, dir) {
  return h('a', { class: 'xlink', href: '#', onclick: (e) => { e.preventDefault(); e.stopPropagation(); select(id, true); } },
    dir === 'back' ? icon('arrow', 'flip-ltr') : null, label, dir === 'fwd' ? icon('arrow', 'flip') : null);
}
const toolChip = (name, extraCls, title, n) => h('span', { class: 'chip' + (extraCls ? ' ' + extraCls : ''), title },
  icon(extraCls && extraCls.includes('res') ? 'tool_result' : 'tool_call'), h('span', { class: 'nm' }, name), n > 1 ? ltr('×' + n) : null);

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
  const anomTitle = () => s.anomalies.map((a) => `${T.anomalies[a.code] || a.code}: ${a.msg}`).join('\n');
  if (s.state === 'pending' || s.state === 'streaming') st = h('span', { class: 'st', title: stateText(s.state) }, h('span', { class: 'spin' }));
  else if (isErr(s)) st = h('span', { class: 'st bad', title: anomTitle() }, icon('error'));
  else if (isWarn(s)) st = h('span', { class: 'st warnc', title: anomTitle() }, icon('error'));
  else st = h('span', { class: 'st ok', title: stateText(s.state) }, icon('check'));
  const u = s.usage;
  const meta = other
    ? [s.status || '', ' ', fmtMs(s.duration_ms)]
    : [s.state === 'streaming' ? h('span', { class: 'strm' }, T.streaming, ' ') : '', fmtMs(s.duration_ms), s.finished_at ? ` · ${fmtK(totalIn(u))}/${fmtK(u.output)} · ${fmtCost(s.cost_usd)}` : ''];
  const r1 = h('div', { class: 'r1' }, h('span', { class: 'rid' }, '#' + s.id), timeEl(s.started_at), st,
    other ? h('span', { class: 'mono' }, `${s.method} ${s.path.slice(0, 40)}`) : h('span', { class: 'lane', title: T.laneTitle(`L${s.lane}`, laneRoleText(s.lane_role), s.session_id) }, `L${s.lane}`),
    h('span', { class: 'meta' }, ...meta));
  el.replaceChildren(r1);
  if (other) return;
  const g = s.gist || { kind: 'other', text: '' };
  const gk = g.kind === 'other' ? null : g.kind;
  const r2 = h('div', { class: 'r2' }, gk ? kindBadge(gk, true) : null, h('span', { class: 'gist', title: g.text, dir: 'auto' }, g.text || '—'));
  el.append(r2);
  const chips = h('div', { class: 'r3' });
  const counts = new Map();
  for (const c of s.tool_calls) counts.set(c.name, (counts.get(c.name) || 0) + 1);
  for (const [name, n] of counts) chips.append(toolChip(name, '', T.toolCallTitle, n));
  const errs = s.tool_results.filter((r) => r.is_error);
  if (errs.length) chips.append(toolChip(errs.map((r) => r.name).join(', '), 'res bad', T.toolErrTitle));
  if (s.stop_reason === 'max_tokens') chips.append(h('span', { class: 'chip bad' }, icon('error'), ltr('max_tokens')));
  if (s.relation === 'rewritten') chips.append(h('span', { class: 'chip res', title: T.rewrittenTitle }, T.rewritten));
  if (chips.childNodes.length) el.append(chips);
  if (S.f.cbar && s.composition) el.append(compBar(s.composition, false));
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
  p.replaceChildren(icon('up'), T.newRows(S.newCount));
}
function refilter() {
  for (const [id, el] of S.rows) el.hidden = !matches(S.ex.get(id));
  updateTotals();
  if (!$('stats').hidden) scheduleStats();
}

// ------------------------------------------------------------------ filters UI
function rebuildSelect(sel, values, current, label) {
  const keep = sel.value;
  const opts = [h('option', { value: '' }, T.all)];
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
    .map(([k, v]) => [k, `${k.length > 13 ? k.slice(0, 8) + '…' : k} · ${T.reqCount(v.n)} · ${fmtTime(v.t)}`]), S.f.session);
  rebuildSelect($('f-lane'), [...lanes].sort((a, b) => a[0] - b[0]).map(([k, v]) => [String(k), `L${k} · ${laneRoleText(v.role)} · ${v.n}`]), S.f.lane);
  rebuildSelect($('f-model'), [...models].map(([k, n]) => [k, `${k} · ${n}`]), S.f.model);
  const tl = $('tools-list');
  const names = [...new Set([...tools.keys(), ...S.f.tools])].sort();
  tl.replaceChildren(...names.map((name) => h('label', null,
    h('input', { type: 'checkbox', checked: S.f.tools.includes(name), onchange: (e) => {
      S.f.tools = e.target.checked ? [...S.f.tools, name] : S.f.tools.filter((t) => t !== name);
      $('tools-count').textContent = S.f.tools.length ? S.f.tools.length : '';
      saveHash(); refilter();
    } }), toolChip(name), h('span', { class: 'size' }, tools.get(name) || 0))));
  if (!names.length) tl.append(h('div', { class: 'note' }, T.noToolCallsYet));
  tl.append(h('div', { class: 'row-btns' }, h('button', { class: 'btn tiny', onclick: () => { S.f.tools = []; buildFilterLists(); saveHash(); refilter(); } }, T.clear)));
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
  if (f.cbar) p.set('cbar', '1');
  if (!$('stats').hidden) p.set('stats', '1');
  if (LANG !== 'he') p.set('lang', LANG);
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
  f.cbar = p.get('cbar') === '1';
  S.tab = p.get('tab') || 'overview';
  S.sel = p.get('sel') ? +p.get('sel') : null;
  $('f-q').value = f.q; $('f-scope').checked = f.scope === 'all';
  $('f-errors').checked = f.errors; $('f-other').checked = f.other; $('f-cbar').checked = f.cbar;
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
    if (!t.n) { el.textContent = S.ex.size ? T.noMatching : T.noTraffic; return; }
    const tt = T.totals;
    el.replaceChildren(h('b', null, ltr(t.n)), tt.requests(t.n), h('b', null, ltr(fmtK(t.in))), tt.in,
      ltr(fmtK(t.cr)), tt.write, ltr(fmtK(t.cw)), ') / ', h('b', null, ltr(fmtK(t.out))), tt.out, h('b', null, ltr(fmtCost(t.cost))), tt.est,
      ltr(fmtWall(t.wall)), t.errors ? h('span', { class: 'err' }, ' · ', icon('error'), tt.errors(t.errors)) : '');
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
  if (!s) { $('detail').replaceChildren(h('div', { class: 'empty' }, T.notLoaded(id))); return; }
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

const skeleton = () => h('div', { class: 'skel', 'aria-busy': 'true' }, h('i'), h('i'), h('i'));

function renderDetail(loading) {
  const pane = $('detail');
  const s = S.ex.get(S.sel);
  if (!s) return;
  const scroll = pane.scrollTop;
  const d = S.detail;
  const u = s.usage;
  const statusCls = s.status == null ? 'status-pend' : s.status >= 400 ? 'status-bad' : 'status-ok';
  const lbl = (t) => h('span', { class: 'lbl' }, t);
  const head = h('div', { class: 'dh' },
    h('h2', null, h('span', { class: 'rid' }, `#${s.id}`), h('span', { class: 'path', dir: 'ltr' }, `${s.method} ${s.path}`),
      h('span', { class: 'status ' + statusCls }, s.status == null ? stateText(s.state) : `${s.status}`),
      s.duration_ms != null ? h('span', { class: 'size' }, ltr(fmtMs(s.duration_ms))) : null,
      s.state === 'streaming' || s.state === 'pending' ? h('span', { class: 'spin', title: stateText(s.state) }) : null),
    h('div', { class: 'sub' },
      s.model ? h('span', { class: 'mono' }, s.model) : null,
      s.kind === 'messages' ? h('span', null, lbl(T.inTok), ltr(fmtK(totalIn(u))),
        ` (${T.uncached} `, ltr(fmtK(u.input)), `, ${T.cacheRead} `, ltr(fmtK(u.cache_read)), `, ${T.write} `, ltr(fmtK(u.cache_write)), ')') : null,
      s.kind === 'messages' ? h('span', null, lbl(T.outTok), ltr(fmtK(u.output))) : null,
      s.kind === 'messages' ? h('span', { title: T.priceEntry(s.cost_source) }, ltr(fmtCost(s.cost_usd)), lbl(T.est)) : null,
      s.ttfb_ms != null ? h('span', null, lbl(T.ttfb), ltr(fmtMs(s.ttfb_ms))) : null,
      s.stop_reason ? h('span', null, lbl(T.stop + ':'), ltr(s.stop_reason)) : null,
      s.kind === 'messages' ? h('span', { title: `${T.session} ${s.session_id}` }, lbl(T.lane), ltr(`L${s.lane}`), ` (${laneRoleText(s.lane_role)})`) : null,
      timeEl(s.started_at)),
    h('div', { class: 'tabs', role: 'tablist' },
      Object.entries(T.tabs).map(([k, label]) => h('button', { class: S.tab === k ? 'on' : '', role: 'tab', 'aria-selected': String(S.tab === k), onclick: () => { S.tab = k; saveHash(); renderDetail(); $('detail').scrollTop = 0; } }, label)),
      h('span', { class: 'kindbar', title: T.kindbarTitle }, Object.keys(KINDS).map((k) => {
        const b = kindBadge(k); b.dataset.kind = k; b.classList.toggle('off', S.f.hide.includes(k));
        b.addEventListener('click', () => setHidden(k, !S.f.hide.includes(k)));
        return b;
      }))));
  const body = h('div', { class: 'db' });
  for (const a of s.anomalies) {
    // The title is translated; the detail message comes from the server and is shown as sent.
    body.append(h('div', { class: 'banner' + (a.level === 'error' ? '' : ' warn') },
      h('b', null, icon('error'), T.anomalies[a.code] || a.code.replace('_', ' ')), h('span', { dir: 'auto' }, a.msg)));
  }
  if (s.relation === 'rewritten') body.append(h('div', { class: 'banner info' }, h('b', null, T.rewritten),
    h('span', null, T.rewrittenBanner(s.prev_id))));
  if (loading || !d) body.append(skeleton());
  else {
    const ctx = { id: s.id, summary: s, pairedResults: d.paired_results, pairedCalls: d.paired_calls, comp: compIndex(d) };
    try {
      ({ overview: renderOverview, request: renderRequest, reply: renderReply, composition: renderComposition,
        changes: renderChanges, raw: renderRaw })[S.tab in T.tabs ? S.tab : 'overview'](body, d, ctx);
    } catch (e) {
      body.append(h('div', { class: 'banner' }, h('b', null, T.renderError), h('span', null, String(e))));
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
    case 'append': return T.rel.append(s.prev_id, s.msg_count - r.new_from, s.msg_count, r.echo_index != null ? r.echo_index + 1 : null);
    case 'rewritten': return T.rel.rewritten(s.prev_id, r.new_from + 1, s.msg_count);
    case 'independent': return T.rel.independent(s.prev_id);
    default: return r.new_from ? T.rel.firstPart(`L${s.lane}`, r.new_from + 1, s.msg_count) : T.rel.firstAll(`L${s.lane}`, s.msg_count);
  }
}

function notParsed(body, d) {
  body.append(h('div', { class: 'banner info' }, h('b', null, T.notParsed),
    h('span', null, d.kind === 'messages' ? T.notParsedMsg : T.notParsedOther)));
}

function renderOverview(body, d, ctx) {
  if (!d.request.parsed) { notParsed(body, d); body.append(kvTable({ [T.kv.status]: d.status, [T.kv.state]: stateText(d.state), [T.kv.duration]: fmtMs(d.duration_ms) })); return; }
  const r = d.request;
  const newMsgs = r.messages.slice(r.new_from);
  body.append(h('div', { class: 'sec k-user', open: true },
    h('div', { class: 'sh' }, kindBadge('user'), h('h3', null, T.newInRequest), h('span', { class: 'size' }, T.messagesN(newMsgs.length))),
    h('div', { class: 'sb' }, h('div', { class: 'note' }, relationNote(ctx.summary, d)),
      newMsgs.length ? newMsgs.map((m, i) => messageView(m, r.new_from + i, ctx))
        : h('div', { class: 'note' }, ctx.summary.prev_id ? T.nothingNewRetry(ctx.summary.prev_id) : T.nothingNew))));
  body.append(replySection(d, ctx));
}

function replySection(d, ctx) {
  const resp = d.response;
  const s = ctx.summary;
  const box = h('div', { class: 'sb', id: 'reply-live' });
  fillReply(box, resp.content || [], resp, s, ctx);
  return h('div', { class: 'sec k-assistant' },
    h('div', { class: 'sh' }, kindBadge('assistant'), h('h3', null, T.reply),
      h('span', { class: 'size' }, s.stop_reason ? ltr(`stop_reason: ${s.stop_reason}`) : stateText(s.state))),
    box);
}
function fillReply(box, content, resp, s, ctx) {
  const parts = [];
  if (resp.error) {
    parts.push(blk('error', { title: resp.error.type, copy: resp.error.message, error: true }, longText(resp.error.message || '')));
  } else if (s.status >= 400) {
    parts.push(blk('error', { title: `HTTP ${s.status}`, error: true }, h('div', { class: 'note' }, T.seeRaw)));
  }
  if (resp.note) parts.push(blk('error', { title: stateText(s.state), error: true }, longText(resp.note)));
  for (const b of content) parts.push(...blockView(b, 'assistant', ctx).filter(Boolean));
  if (!content.length && !parts.length) parts.push(h('div', { class: 'note' }, s.state === 'pending' ? T.waitingReply : s.state === 'streaming' ? T.streaming : T.noContent));
  if (s.state === 'streaming') parts.push(h('div', { class: 'note' }, h('span', { class: 'spin' }), ' ', T.streaming));
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
  for (const [k, v] of headers || []) g.append(h('div', { dir: 'ltr' }, k), h('div', { class: 'mono', dir: 'ltr' }, v));
  return g;
}

function renderRequest(body, d, ctx) {
  const r = d.request;
  body.append(section(T.paramsHeaders, null, { open: false }, () => [
    kvTable({ model: r.model, max_tokens: r.max_tokens, temperature: r.temperature, thinking: r.thinking, stream: r.stream, metadata: r.metadata, ...r.other_params }),
    h('div', { class: 'note' }, T.reqHeaders), headersTable(r.headers)]));
  if (!r.parsed) { notParsed(body, d); return; }
  const sysText = r.system.map((b) => b.text || '').join('\n\n');
  body.append(section(T.system, 'system', { open: false, sec: 'system', size: sysText.length, copy: sysText, extra: h('span', { class: 'size' }, T.blocks(r.system.length)) }, () =>
    r.system.length ? r.system.flatMap((b, i) => {
      const ref = `s:${i}`;
      const tb = textBlockBody(b.text || '', piecesOf(ctx, ref));
      const el = blk('system', { title: T.block(i + 1), size: (b.text || '').length, copy: b.text || '', md: tb }, tb);
      el.dataset.ref = ref; addSourceChips(el, ref, ctx);
      return [el, cacheMark(b)];
    }).filter(Boolean) : h('div', { class: 'note' }, T.noSystem)));
  const toolsSize = JSON.stringify(r.tools).length;
  body.append(section(T.toolsN(r.tools.length), 'tools', { open: false, sec: 'tools', size: toolsSize, copy: () => JSON.stringify(r.tools, null, 2) }, () =>
    r.tools.length ? r.tools.flatMap((t, i) => {
      const size = JSON.stringify(t).length;
      const ref = `t:${i}`;
      const el = blk('tools', { title: t.name || t.type || '?', open: false, size, copy: () => JSON.stringify(t, null, 2),
        extra: t.type && !t.input_schema ? h('span', { class: 'size' }, t.type) : null }, () => [
        t.description ? textBlockBody(t.description) : null,
        t.input_schema ? h('div', { class: 'tk note' }, 'input_schema') : null,
        jsonView(t.input_schema || t, 0)]);
      el.dataset.ref = ref; addSourceChips(el, ref, ctx);
      return [el, cacheMark(t)];
    }).filter(Boolean) : h('div', { class: 'note' }, T.noTools)));
  const earlier = r.messages.slice(0, r.new_from);
  const earlierSize = earlier.reduce((n, m) => n + JSON.stringify(m.content).length, 0);
  body.append(section(T.convSoFar(earlier.length), null, { open: false, sec: 'earlier', size: earlierSize }, () =>
    earlier.length ? earlier.map((m, i) => messageView(m, i, ctx, i === r.echo_index ? 'echo' : null)) : h('div', { class: 'note' }, T.none)));
  const newMsgs = r.messages.slice(r.new_from);
  body.append(section(T.newMsgs(newMsgs.length), 'user', { open: true, sec: 'new', size: newMsgs.reduce((n, m) => n + JSON.stringify(m.content).length, 0),
    extra: h('span', { class: 'size' }, relationNote(ctx.summary, d)) }, () => newMsgs.map((m, i) => messageView(m, r.new_from + i, ctx))));
}

function renderReply(body, d, ctx) {
  const resp = d.response;
  const s = ctx.summary;
  body.append(replySection(d, ctx));
  const kv = T.kv;
  body.append(section(T.usageTiming, null, { open: true }, () => [
    kvTable({
      stop_reason: resp.stop_reason, stop_sequence: resp.stop_sequence ?? undefined,
      [kv.input]: s.usage.input, [kv.cacheRead]: s.usage.cache_read, [kv.cacheWrite]: s.usage.cache_write, [kv.output]: s.usage.output,
      [kv.cost]: T.costEntry(fmtCost(s.cost_usd), s.cost_source),
      [kv.started]: fmtFull(s.started_at),
      [kv.ttfb]: fmtMs(s.ttfb_ms), [kv.duration]: fmtMs(s.duration_ms), [kv.state]: stateText(s.state),
    }),
    h('div', { class: 'note' }, T.usageRaw), jsonView(resp.usage_raw, 1),
    resp.message && Object.keys(resp.message).length ? [h('div', { class: 'note' }, T.messageObj), jsonView(resp.message, 1)] : null,
  ]));
  body.append(section(T.replyHeaders, null, { open: false }, () => headersTable(resp.headers)));
}

function diffView(lines) {
  const pre = h('pre', { class: 'diff', dir: 'ltr' });
  for (const l of lines) {
    const cls = l.startsWith('@@') ? 'hunk' : l.startsWith('+++') || l.startsWith('---') ? 'hunk' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : null;
    pre.append(h('span', { class: cls || '' }, l + '\n'));
  }
  return pre;
}

function renderChanges(body, d, ctx) {
  const c = d.changes;
  if (!c || !c.available) { notParsed(body, d); return; }
  if (c.first) { body.append(h('div', { class: 'banner info' }, h('b', null, T.firstRequest), h('span', null, T.firstNothing(`L${ctx.summary.lane}`)))); return; }
  body.append(h('div', { class: 'note' }, T.comparedWith, xlink(c.prev_id, `#${c.prev_id}`), T.comparedTail(`L${ctx.summary.lane}`)));
  if (!c.system.changed && !c.tools.changed) body.append(h('div', { class: 'banner info' }, h('b', null, T.unchanged), h('span', null, T.unchangedMsg)));
  if (c.system.changed) {
    body.append(section(T.sysChanged, 'system', { open: true }, () =>
      c.system.diff.length ? diffView(c.system.diff) : h('div', { class: 'note' }, T.sysStructOnly)));
  }
  if (c.tools.changed) {
    body.append(section(T.toolsChanged, 'tools', { open: true }, () => [
      [T.toolOps.added, c.tools.added], [T.toolOps.removed, c.tools.removed], [T.toolOps.changed, c.tools.modified],
    ].filter(([, l]) => l.length).map(([k, l]) => h('div', null, h('b', null, k + ': '), ltr(l.join(', '), 'mono')))));
  }
  body.append(section(T.params, null, { open: true }, () => c.params.length
    ? h('ul', { class: 'plain' }, c.params.map((p) => h('li', null, ltr(`${p.name}: ${JSON.stringify(p.before)} → ${JSON.stringify(p.after)}`, 'mono'))))
    : h('div', { class: 'note' }, T.paramsSame)));
  if (c.composition && c.composition.length) {
    const isChanged = (x) => (x.changed != null ? x.changed : x.after !== x.before);
    const changed = c.composition.filter(isChanged).sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before));
    const same = c.composition.filter((x) => !isChanged(x) && x.after > 0);
    body.append(section(T.comp.changes, null, { open: true }, () => [
      changed.length ? h('table', { class: 'comp' }, h('tbody', null, changed.map((x) => {
        const dlt = x.after - x.before;
        return h('tr', null, h('td', null, srcChip({ source: x.source }, false)),
          h('td', { class: 'n' }, ltr(`${approx(x.before)} → ${approx(x.after)}`)),
          h('td', { class: 'n ' + (dlt > 0 ? 'delta-up' : dlt < 0 ? 'delta-down' : '') }, ltr((dlt > 0 ? '+' : dlt < 0 ? '−' : '±') + fmtK(Math.abs(dlt)))));
      }))) : null,
      same.length ? h('div', { class: 'note', style: 'margin-top:8px' }, T.comp.unchangedList, same.map((x) => srcLabel(x.source)).join(', ')) : null,
    ]));
  }
  const m = c.messages;
  body.append(section(T.messages, 'user', { open: true }, () => {
    if (m.mode === 'append') return h('div', null, T.normalAppend(m.kept, m.added, m.echo_index != null ? m.echo_index + 1 : null, c.prev_id));
    if (m.mode === 'independent') return h('div', null, T.noShared);
    return m.ops.map((op) => {
      if (op.op === 'equal') return h('div', { class: 'op' }, h('div', { class: 'oh' }, T.opEqual(op.count, op.from + 1, op.from + op.count)));
      if (op.op === 'modified') return h('div', { class: 'op modified' }, h('div', { class: 'oh' }, T.opModified(roleText(op.role), op.prev_index + 1, op.index + 1)), diffView(op.diff));
      return h('div', { class: 'op ' + op.op }, h('div', { class: 'oh' }, op.op === 'added' ? T.opAdded(roleText(op.role), op.index + 1) : T.opRemoved(roleText(op.role), op.prev_index + 1)),
        longText(op.preview, 'code'));
    });
  }));
}

async function renderRaw(body, d) {
  const holder = h('div', null, h('div', { class: 'empty' }, T.loadingRaw));
  body.append(holder);
  const id = d.id;
  let raw;
  try { raw = await fetch(`/api/exchanges/${id}/raw`).then((r) => r.json()); } catch (_) { return; }
  if (S.sel !== id || S.tab !== 'raw') return;
  holder.replaceChildren(
    section(T.request, null, { open: true, size: raw.request.length, copy: raw.request }, () => [
      headersTable(raw.request_headers), h('div', { class: 'note' }, T.rawBodyNote),
      h('pre', { class: 'raw', dir: 'ltr' }, raw.request || T.empty)]),
    section([T.reply, ' ', ltr(`${raw.status ?? ''} ${raw.reason || ''}`.trim())], null, { open: true, size: raw.response.length, copy: raw.response }, () => [
      headersTable(raw.response_headers), h('pre', { class: 'raw', dir: 'ltr' }, raw.response || T.empty)]));
  highlight(holder);
}

// ------------------------------------------------------------------ prompt composition (SPEC 6.10)
const SRC_ICONS = {
  system_prompt: 'system', tools_builtin: 'tools', tools_mcp: 'plug', claude_md: 'file', memory: 'memory', skills: 'skill',
  hooks: 'hook', environment: 'env', system_reminder: 'bell', user_prompt: 'user', history: 'clock', tool_results: 'tool_result',
  media: 'image', other: 'other',
};
function setSources(list) {
  S.srcOrder = list.map((x) => x.id);
  S.srcMap = new Map(list.map((x) => [x.id, x]));
  rerenderDetail();
  if (S.f.cbar) for (const [id, el] of S.rows) fillRow(el, S.ex.get(id));
  if (!$('stats').hidden) renderStats();
}
const srcLabel = (id) => {
  const l = S.srcMap.get(id)?.label || {};
  return l[LANG] || l.he || l.en || id;
};
const srcStyle = (id) => `--c:var(--src-${id}, var(--muted))`;
const srcRank = (id) => { const i = S.srcOrder.indexOf(id); return i < 0 ? 999 : i; };
const approx = (n) => '≈' + fmtK(n);

/* A source chip: icon + label (+ ≈tokens). Never color alone (SPEC 6.10). */
function srcChip(seg, withTokens = true) {
  const tip = [srcLabel(seg.source), seg.detail, seg.cache ? T.comp.cache[seg.cache] : null].filter(Boolean).join(' · ');
  return h('span', { class: 'srcchip src', style: srcStyle(seg.source), title: tip },
    icon(SRC_ICONS[seg.source] || 'other'), srcLabel(seg.source),
    withTokens && seg.tokens != null ? h('span', { class: 'tk' }, approx(seg.tokens)) : null);
}
function compIndex(d) {
  const c = d && d.composition;
  if (!c || !c.segments || !c.segments.length) return null;
  const byRef = new Map();
  for (const sg of c.segments) {
    if (!byRef.has(sg.ref)) byRef.set(sg.ref, []);
    byRef.get(sg.ref).push(sg);
  }
  return { segs: c.segments, exact: c.exact, total: c.total, byRef };
}
function piecesOf(ctx, ref) {
  const list = ctx && ctx.comp && ref ? ctx.comp.byRef.get(ref) : null;
  return list && list.length > 1 && list.every((sg) => sg.start != null) ? list : null;
}
function addSourceChips(el, ref, ctx) {
  const list = ctx && ctx.comp ? ctx.comp.byRef.get(ref) : null;
  if (!list || !list.length) return;
  const summary = el.querySelector(':scope > summary');
  if (!summary) return;
  summary.insertBefore(h('span', { class: 'srcchips' }, list.map((sg) => srcChip(sg))), summary.querySelector(':scope > .acts'));
}
/* A stacked bar of tokens per source. `onPick(source)` makes segments clickable. */
function compBar(totals, big, onPick) {
  const entries = Object.entries(totals || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const sum = entries.reduce((n, [, v]) => n + v, 0) || 1;
  const bar = h('div', { class: 'cbar' + (big ? ' big' : ''), role: 'img',
    'aria-label': entries.map(([k, v]) => `${srcLabel(k)} ${approx(v)}`).join(', ') });
  for (const [k, v] of entries) {
    const pct = (100 * v / sum).toFixed(1) + '%';
    const seg = h('i', { style: `${srcStyle(k)};flex:${v} 1 0`, title: big ? null : `${srcLabel(k)} · ${approx(v)} · ${pct}` });
    if (big) {
      seg.addEventListener('mousemove', (e) => tip.show(e, `${srcLabel(k)}\n${approx(v)} ${T.tokens} · ${pct}`));
      seg.addEventListener('mouseleave', tip.hide);
      if (onPick) seg.addEventListener('click', () => { tip.hide(); onPick(k); });
    }
    bar.append(seg);
  }
  return bar;
}
function locText(sg, d) {
  const [kind, a, b] = sg.ref.split(':');
  const L = T.comp.loc;
  let text;
  if (kind === 't') text = L.tool((d.request.tools[+a] || {}).name || '#' + (+a + 1));
  else if (kind === 's') text = L.sys(+a + 1);
  else text = L.msg(+a + 1, +b + 1);
  return sg.start != null ? `${text} · ${L.chars(sg.start, sg.end)}` : text;
}
/* Open the Request tab at the block a segment came from, and flash it. */
function jumpTo(ref) {
  if (!S.detail) return;
  S.tab = 'request'; saveHash(); renderDetail();
  const pane = $('detail');
  const [kind, a] = ref.split(':');
  const sec = kind === 't' ? 'tools' : kind === 's' ? 'system' : (+a < S.detail.request.new_from ? 'earlier' : 'new');
  const sd = pane.querySelector(`details[data-sec="${sec}"]`);
  if (!sd) return;
  sd.open = true; if (sd._build) sd._build();
  const el = pane.querySelector(`[data-ref="${ref}"]`);
  if (!el) return;
  if (el.tagName === 'DETAILS') { el.open = true; if (el._build) el._build(); }
  el.scrollIntoView({ block: 'center' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1700);
}

function renderComposition(body, d, ctx) {
  const c = ctx.comp;
  if (!c) {
    if (d.request.parsed && !('composition' in d)) body.append(h('div', { class: 'banner warn' }, h('b', null, icon('error'), T.comp.noComp), h('span', null, T.comp.oldServer)));
    else body.append(h('div', { class: 'note' }, d.request.parsed ? T.comp.noComp : T.notParsedOther));
    return;
  }
  const u = ctx.summary.usage;
  const finished = ctx.summary.finished_at != null;
  if (!c.exact) body.append(h('div', { class: 'banner info' }, h('b', null, icon('clock'), T.comp.estNote), h('span', null, finished ? T.comp.noUsage : T.comp.notCalibrated)));
  const groups = new Map();
  for (const sg of c.segs) {
    const g = groups.get(sg.source) || { source: sg.source, tokens: 0, segs: [] };
    g.tokens += sg.tokens; g.segs.push(sg); groups.set(sg.source, g);
  }
  const total = c.total || 1;
  const totals = Object.fromEntries([...groups.values()].map((g) => [g.source, g.tokens]));
  const biggest = (src) => groups.get(src).segs.reduce((a, b) => (b.tokens > a.tokens ? b : a));
  body.append(h('div', { class: 'comp-total' },
    h('span', null, T.comp.totalExact + ': ', h('b', null, ltr((c.exact ? '' : '≈') + fmtK(c.total))), ` ${T.tokens} (${c.exact ? T.comp.exactNote : T.comp.estNote})`),
    c.exact ? h('span', null, T.comp.cacheRead + ' ', ltr(fmtK(u.cache_read))) : null,
    c.exact ? h('span', null, T.comp.cacheWrite + ' ', ltr(fmtK(u.cache_write))) : null,
    c.exact ? h('span', null, T.comp.uncached + ' ', ltr(fmtK(u.input))) : null));
  body.append(compBar(totals, true, (src) => jumpTo(biggest(src).ref)));
  body.append(h('div', { class: 'note' }, T.comp.note));

  const holder = h('div');
  const toggle = h('div', { class: 'seg-toggle', role: 'group' },
    [['source', T.comp.bySource], ['all', T.comp.allSegs]].map(([k, label]) => h('button', {
      class: S.compMode === k ? 'on' : '', 'aria-pressed': String(S.compMode === k),
      onclick: () => { S.compMode = k; toggle.querySelectorAll('button').forEach((b, i) => { const on = (i === 0) === (k === 'source'); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); fill(); },
    }, label)));
  const pctCell = (tok, src) => h('td', { class: 'n' }, h('span', { class: 'pct src', style: srcStyle(src) },
    h('i', { style: `width:${Math.max(2, Math.round(60 * tok / total))}px` }), ltr((100 * tok / total).toFixed(1) + '%')));
  const cacheCell = (cache) => h('td', { class: cache ? 'cache-' + cache : '' }, cache ? T.comp.cache[cache] : '–');
  const segRow = (sg, sub) => h('tr', { class: sub ? 'sub' : '' },
    h('td', null, sub ? (sg.detail ? h('span', { class: 'det' }, sg.detail) : '') : srcChip(sg, false)),
    h('td', null, h('a', { class: 'xlink', href: '#', title: T.comp.goto, onclick: (e) => { e.preventDefault(); jumpTo(sg.ref); } },
      h('span', { class: 'loc' }, locText(sg, d))), !sub && sg.detail ? [' ', h('span', { class: 'det' }, sg.detail)] : null),
    h('td', { class: 'n' }, ltr(approx(sg.tokens))), pctCell(sg.tokens, sg.source), cacheCell(sg.cache));
  const LIMIT = 40;
  function fill() {
    const head = h('thead', null, h('tr', null, T.comp.cols.map((x, i) => h('th', { class: i >= 2 && i <= 3 ? 'n' : '' }, x))));
    const tb = h('tbody');
    if (S.compMode === 'all') {
      const all = [...c.segs].sort((a, b) => b.tokens - a.tokens);
      let shown = Math.min(all.length, LIMIT * 2);
      const draw = () => {
        tb.replaceChildren(...all.slice(0, shown).map((sg) => segRow(sg, false)));
        if (shown < all.length) tb.append(h('tr', null, h('td', { colspan: 5 }, h('button', { class: 'btn tiny', onclick: () => { shown = all.length; draw(); } }, T.comp.more(all.length - shown)))));
      };
      draw();
    } else {
      for (const g of [...groups.values()].sort((a, b) => b.tokens - a.tokens)) {
        const caches = new Set(g.segs.map((x) => x.cache));
        const open = S.compOpen.has(g.source);
        const tr = h('tr', { class: 'grp', 'aria-expanded': String(open), tabindex: '0' },
          h('td', null, srcChip({ source: g.source }, false)),
          h('td', null, h('span', { class: 'loc' }, T.comp.parts(g.segs.length))),
          h('td', { class: 'n' }, ltr(approx(g.tokens))), pctCell(g.tokens, g.source),
          cacheCell(caches.size === 1 ? [...caches][0] : 'mixed'));
        const flip = () => { if (S.compOpen.has(g.source)) S.compOpen.delete(g.source); else S.compOpen.add(g.source); fill(); };
        tr.addEventListener('click', flip);
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
        tb.append(tr);
        if (open) {
          const segs = [...g.segs].sort((a, b) => b.tokens - a.tokens);
          tb.append(...segs.slice(0, LIMIT).map((sg) => segRow(sg, true)));
          if (segs.length > LIMIT) tb.append(h('tr', { class: 'sub' }, h('td', { colspan: 5 }, T.comp.more(segs.length - LIMIT))));
        }
      }
    }
    holder.replaceChildren(h('table', { class: 'comp' }, head, tb));
  }
  fill();
  body.append(h('div', { class: 'sec', style: 'padding:12px 16px' }, toggle, holder));
}

// ------------------------------------------------------------------ stats drawer
function toggleStats(force) {
  const st = $('stats');
  st.hidden = force != null ? !force : !st.hidden;
  $('b-stats').setAttribute('aria-expanded', String(!st.hidden));
  $('b-stats').classList.toggle('on', !st.hidden);
  statsLabel();
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

/* Prompt composition over time: input tokens per request, stacked by source (SPEC 6.10). */
function compChart(list) {
  const withComp = list.filter((s) => s.composition);
  const present = new Set();
  for (const s of withComp) for (const [k, v] of Object.entries(s.composition)) if (v > 0) present.add(k);
  const ids = [...present].sort((a, b) => srcRank(a) - srcRank(b));
  const series = ids.map((id) => ({ label: srcLabel(id), color: `--src-${id}`, get: (s) => (s.composition || {})[id] || 0 }));
  const tipFn = (s) => [`#${s.id} · ${fmtTime(s.started_at)} · L${s.lane}`,
    ...Object.entries(s.composition || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([k, v]) => `${srcLabel(k)}: ${approx(v)}`)].join('\n');
  return h('div', { class: 'chart' }, h('h4', null, T.comp.chart), legend(series.map((x) => [x.label, x.color])),
    h('div', { class: 'plot' }, withComp.length ? stackedBars(withComp, series, fmtK, tipFn) : h('div', { class: 'note' }, T.noFinished)));
}

function legend(items) {
  return h('div', { class: 'legend' }, items.map(([label, color]) => h('span', null, h('i', { style: `background:var(${color})` }), label)));
}

function renderStats() {
  const list = visibleMessages().filter((s) => s.finished_at);
  const t = totalsOf(list);
  const st = $('stats');
  const scopeLabel = S.f.session ? T.sessionScope(S.f.session.slice(0, 8)) : T.allSessions;
  const tile = (v, l, bad) => h('div', { class: 'tile' + (bad ? ' bad' : '') }, h('div', { class: 'v' }, v), h('div', { class: 'l' }, l));
  const tiles = h('div', { class: 'tiles' },
    tile(t.n, T.tiles.requests), tile(fmtK(t.unc), T.tiles.input), tile(fmtK(t.cr), T.tiles.cacheRead), tile(fmtK(t.cw), T.tiles.cacheWrite),
    tile(fmtK(t.out), T.tiles.output), tile(fmtCost(t.cost), T.tiles.cost), tile(fmtWall(t.wall), T.tiles.wall), tile(t.errors, T.tiles.errors, t.errors > 0));
  const note = h('div', { class: 'note' }, T.statsNote(scopeLabel));
  const se = T.series;

  const tokSeries = [
    { label: se.cacheRead, color: '--s1', get: (s) => s.usage.cache_read },
    { label: se.cacheWrite, color: '--s2', get: (s) => s.usage.cache_write },
    { label: se.input, color: '--s3', get: (s) => s.usage.input },
    { label: se.output, color: '--s4', get: (s) => s.usage.output },
  ];
  // Tooltip lines: each line takes its own direction (CSS unicode-bidi: plaintext).
  const tokTip = (s) => [`#${s.id} · ${fmtTime(s.started_at)} · L${s.lane}`, `${se.cacheRead}: ${fmtK(s.usage.cache_read)}`,
    `${se.cacheWrite}: ${fmtK(s.usage.cache_write)}`, `${se.input}: ${fmtK(s.usage.input)}`, `${se.output}: ${fmtK(s.usage.output)}`,
    `${T.tipCost}: ${fmtCost(s.cost_usd)}`].join('\n');
  const latSeries = [
    { label: se.ttfb, color: '--s1', get: (s) => s.ttfb_ms || 0 },
    { label: se.rest, color: '--s2', get: (s) => Math.max(0, (s.duration_ms || 0) - (s.ttfb_ms || 0)) },
  ];
  const latTip = (s) => [`#${s.id} · ${s.model || ''}`, `${se.ttfb}: ${fmtMs(s.ttfb_ms)}`, `${T.tipDuration}: ${fmtMs(s.duration_ms)}`].join('\n');

  // Tool usage
  const tools = new Map();
  for (const s of list) {
    for (const c of s.tool_calls) { const t2 = tools.get(c.name) || { calls: 0, results: 0, errors: 0, size: 0 }; t2.calls++; tools.set(c.name, t2); }
    for (const r of s.tool_results) { const t2 = tools.get(r.name) || { calls: 0, results: 0, errors: 0, size: 0 }; t2.results++; t2.size += r.size; if (r.is_error) t2.errors++; tools.set(r.name, t2); }
  }
  const toolRows = [...tools].sort((a, b) => b[1].calls - a[1].calls);
  const toolTable = h('table', null, h('thead', null, h('tr', null, T.toolTable.map((x) => h('th', null, x)))),
    h('tbody', null, toolRows.map(([name, v]) => h('tr', null,
      h('td', null, h('a', { title: T.filterToTool, onclick: () => { S.f.tools = [name]; buildFilterLists(); saveHash(); refilter(); } }, icon('tool_call'), ltr(name, 'mono'))),
      h('td', null, v.calls), h('td', null, v.results), h('td', { class: v.errors ? 'errtag' : '' }, v.errors ? [icon('error'), ' ', v.errors] : 0),
      h('td', null, v.results ? Math.round(100 * v.errors / v.results) + '%' : '–'),
      h('td', null, v.results ? sizeText(Math.round(v.size / v.results)).split(' · ')[0] : '–')))));

  // Context growth: the largest lane is drawn as a line; other lanes as grey points.
  const laneCount = new Map();
  for (const s of list) { const k = s.session_id + '/' + s.lane; laneCount.set(k, (laneCount.get(k) || 0) + 1); }
  const mainLane = [...laneCount].sort((a, b) => b[1] - a[1])[0]?.[0];
  const inMain = (s) => s.session_id + '/' + s.lane === mainLane;

  const charts = h('div', { class: 'charts' },
    h('div', { class: 'chart' }, h('h4', null, T.charts.tokens), legend(tokSeries.map((s) => [s.label, s.color])),
      h('div', { class: 'plot' }, list.length ? stackedBars(list, tokSeries, fmtK, tokTip) : h('div', { class: 'note' }, T.noFinished))),
    compChart(list),
    h('div', { class: 'chart' }, h('h4', null, T.charts.latency), legend(latSeries.map((s) => [s.label, s.color])),
      h('div', { class: 'plot' }, list.length ? stackedBars(list, latSeries, (v) => fmtMs(Math.round(v)), latTip) : h('div', { class: 'note' }, T.noFinished))),
    h('div', { class: 'chart' }, h('h4', null, T.charts.context),
      legend([[T.largestLane(`L${mainLane ? mainLane.split('/').pop() : '?'}`), '--s1'], [T.otherLanes, '--muted']]),
      h('div', { class: 'plot' }, list.length ? lineChart(list, (s) => totalIn(s.usage), inMain,
        (s) => [`#${s.id} · L${s.lane}`, `${T.tipContext}: ${fmtK(totalIn(s.usage))} ${T.tokens}`].join('\n')) : h('div', { class: 'note' }, T.noFinished)),
      h('div', { class: 'note' }, T.compactionNote)),
    h('div', { class: 'chart' }, h('h4', null, T.charts.tools), toolRows.length ? toolTable : h('div', { class: 'note' }, T.noToolCalls)));
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
  es.onopen = () => { S.connected = true; liveState(); resync(); };
  es.onerror = () => { S.connected = false; liveState(); };
  for (const type of ['exchange.started', 'exchange.updated', 'exchange.finished']) {
    es.addEventListener(type, (e) => {
      const data = JSON.parse(e.data);
      if (S.paused) { S.queued.push([type, data]); pauseLabel(); return; }
      applyEvent(type, data);
    });
  }
}

// ------------------------------------------------------------------ top-bar labels, theme, pane resizer
function statsLabel() {
  const open = !$('stats').hidden;
  $('b-stats').replaceChildren(icon('chart'), T.stats, icon(open ? 'up' : 'down'));
}
function pauseLabel() {
  const b = $('b-pause');
  b.classList.toggle('on', S.paused);
  b.title = T.pauseTitle;
  b.replaceChildren(icon(S.paused ? 'play' : 'pause'), S.paused ? T.resume : T.pause,
    ...(S.paused && S.queued.length ? [ltr(`(${S.queued.length})`)] : []));
}
function liveState() {
  if (!S.connected) setLive('off', T.disconnected);
  else setLive(S.paused ? 'paused' : 'on', S.paused ? T.paused : T.live);
}

/* Language: Hebrew by default; the hash (lang=) overrides the stored choice (SPEC 6.8). */
function initialLang() {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('lang');
  if (LANGS.includes(fromHash)) return fromHash;
  try { const st = localStorage.getItem('lang'); if (LANGS.includes(st)) return st; } catch (_) { /* ignore */ }
  return 'he';
}
function applyStaticStrings() {
  const ui = T.ui;
  document.querySelectorAll('[data-i18n]').forEach((el) => { const v = ui[el.dataset.i18n]; if (v != null) el.textContent = v; });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { const v = ui[el.dataset.i18nTitle]; if (v != null) el.title = v; });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { const v = ui[el.dataset.i18nPlaceholder]; if (v != null) el.placeholder = v; });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => { const v = ui[el.dataset.i18nAria]; if (v != null) el.setAttribute('aria-label', v); });
  document.title = ui.brand;
}
/* Switch language live: no reload; selection, filters, scroll and the live connection all stay. */
function setLang(lang, remember) {
  LANG = LANGS.includes(lang) ? lang : 'he';
  T = mergeStrings(STRINGS[LANG === 'he' ? 'en' : 'he'], STRINGS[LANG]);
  setLocale(LANG);
  const root = document.documentElement;
  root.lang = LANG; root.dir = LANG === 'he' ? 'rtl' : 'ltr';
  applyStaticStrings();
  $('b-lang').dataset.lang = LANG;
  if (remember) { try { localStorage.setItem('lang', LANG); } catch (_) { /* ignore */ } }
}
function relabelAll() {
  const listScroll = $('list').scrollTop;
  buildKindsMenu(); buildFilterLists();
  for (const [id, el] of S.rows) fillRow(el, S.ex.get(id));
  updateTotals(); statsLabel(); pauseLabel(); liveState(); setTheme(currentTheme()); showPill();
  if (!$('stats').hidden) renderStats();
  if (S.sel != null && S.ex.has(S.sel)) renderDetail(!S.detail);
  else $('detail').querySelector('.empty [data-i18n]')?.replaceChildren(T.ui.selectHint);
  $('list').scrollTop = listScroll;
}

/* Theme follows the OS by default; the toggle cycles auto → light → dark and is remembered. */
const THEMES = ['auto', 'light', 'dark'];
function currentTheme() {
  try { const t = localStorage.getItem('theme'); return THEMES.includes(t) ? t : 'auto'; } catch (_) { return 'auto'; }
}
function setTheme(t) {
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try { if (t === 'auto') localStorage.removeItem('theme'); else localStorage.setItem('theme', t); } catch (_) { /* storage unavailable */ }
  const b = $('b-theme');
  b.replaceChildren(icon(t === 'dark' ? 'moon' : t === 'light' ? 'sun' : 'auto'));
  b.title = T.theme[t];
  b.setAttribute('aria-label', T.theme[t]);
}

/* Drag (or arrow keys on) the divider to resize the list pane. Works in RTL: the list is on the right. */
function initResizer() {
  const main = $('main'), bar = $('resizer');
  const isRtl = () => document.documentElement.dir === 'rtl';
  const apply = (pct) => { pct = Math.max(20, Math.min(70, pct)); main.style.setProperty('--list-w', pct + '%'); return pct; };
  let saved = null;
  try { saved = parseFloat(localStorage.getItem('listW')); } catch (_) { /* ignore */ }
  if (saved) apply(saved);
  const save = (pct) => { try { localStorage.setItem('listW', String(pct)); } catch (_) { /* ignore */ } };
  const pctAt = (x) => {
    const r = main.getBoundingClientRect();
    return 100 * (isRtl() ? r.right - x : x - r.left) / r.width;
  };
  bar.addEventListener('pointerdown', (e) => {
    e.preventDefault(); bar.setPointerCapture(e.pointerId); document.body.classList.add('resizing');
    let pct = null;
    const move = (ev) => { pct = apply(pctAt(ev.clientX)); };
    const up = () => {
      bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing'); if (pct != null) save(pct);
    };
    bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up);
  });
  bar.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const cur = parseFloat(main.style.getPropertyValue('--list-w')) || 36;
    const grow = (e.key === 'ArrowLeft') === isRtl();
    save(apply(cur + (grow ? 2 : -2)));
  });
}

// ------------------------------------------------------------------ wiring
function init() {
  setLang(initialLang(), false);
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
  $('f-cbar').addEventListener('change', (e) => {
    S.f.cbar = e.target.checked; saveHash();
    for (const [id, el] of S.rows) fillRow(el, S.ex.get(id));
  });
  $('f-q').addEventListener('input', (e) => { S.f.q = e.target.value; saveHash(); runSearch(); });
  $('f-scope').addEventListener('change', (e) => { S.f.scope = e.target.checked ? 'all' : ''; saveHash(); runSearch(); });
  $('b-stats').addEventListener('click', () => toggleStats());
  $('b-pause').addEventListener('click', () => {
    S.paused = !S.paused;
    if (!S.paused) { const q = S.queued; S.queued = []; for (const [t, d] of q) applyEvent(t, d); }
    pauseLabel(); liveState();
  });
  $('b-lang').addEventListener('click', () => { setLang(LANG === 'he' ? 'en' : 'he', true); saveHash(); relabelAll(); });
  $('b-theme').addEventListener('click', () => setTheme(THEMES[(THEMES.indexOf(currentTheme()) + 1) % THEMES.length]));
  setTheme(currentTheme());
  statsLabel(); pauseLabel();
  initResizer();
  document.addEventListener('click', (e) => {
    for (const m of document.querySelectorAll('details.menu[open]')) if (!m.contains(e.target)) m.open = false;
  });
  // Keyboard: ↓/j next (older), ↑/k previous (newer), Enter opens, Esc closes a menu, drawer or expanded block, / searches.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const menu = document.querySelector('details.menu[open]');
      if (menu) { menu.open = false; menu.querySelector('summary').focus(); return; }
      if (e.target.matches('input, select, textarea')) { e.target.blur(); return; }
      const blkOpen = document.activeElement && document.activeElement.closest && document.activeElement.closest('#detail details[open]');
      if (blkOpen) { blkOpen.open = false; blkOpen.querySelector('summary')?.focus(); return; }
      if (!$('stats').hidden) toggleStats(false);
      return;
    }
    if (e.target.matches('input, select, textarea, button, summary, a')) return;
    const down = e.key === 'j' || e.key === 'ArrowDown', up = e.key === 'k' || e.key === 'ArrowUp';
    if ((down || up) && !e.target.closest('#detail')) {
      e.preventDefault();
      const rows = [...$('list').children].filter((r) => !r.hidden);
      const i = rows.findIndex((r) => +r.dataset.id === S.sel);
      const next = rows[down ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1)];
      if (next) select(+next.dataset.id, true);
    }
    if (e.key === 'Enter' && S.sel == null) {
      const first = [...$('list').children].find((r) => !r.hidden);
      if (first) select(+first.dataset.id, true);
    }
    if (e.key === '/') { e.preventDefault(); $('f-q').focus(); }
  });
  fetch('/api/info').then((r) => r.json()).then((info) => {
    S.info = info;
    setSources(info.sources || []);
    $('hint-cmd').textContent = `ANTHROPIC_BASE_URL=http://localhost:${info.proxy_port} claude`;
  }).catch(() => {});
  if (S.f.q) runSearch();
  connect();
}
init();
