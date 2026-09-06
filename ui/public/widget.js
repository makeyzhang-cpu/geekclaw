/*!
 * GeekClaw 网页访客挂件 (web chat widget)
 *
 * 用法（一行嵌入客户官网）：
 *   <script src="https://<host>/widget.js" data-key="<站点标识>"></script>
 *
 * 设计约束：
 * 1. 零依赖、单文件、原生 JS —— 它是被塞进别人网站的，体积与副作用必须最小。
 * 2. 全部 DOM 与样式封在 Shadow DOM 里：既不污染宿主页面，也不被宿主 CSS 破坏。
 * 3. 不写全局变量（除 `window.GeekClawWidget` 这个显式入口），不用任何框架。
 * 4. 任何异常都只影响挂件自身，绝不向上抛到宿主页面。
 */
(function () {
  'use strict';

  var script = document.currentScript;
  if (!script) return;

  var KEY = script.getAttribute('data-key');
  if (!KEY) {
    console.warn('[GeekClaw] 缺少 data-key，挂件未启动');
    return;
  }

  // API 基址：默认取脚本自身所在源，可用 data-api 覆盖（便于本地/私有化部署）。
  var API = script.getAttribute('data-api') || '';
  if (!API) {
    try {
      API = new URL(script.src).origin;
    } catch (e) {
      console.warn('[GeekClaw] 无法确定 API 地址，挂件未启动');
      return;
    }
  }
  API = API.replace(/\/$/, '');

  var BOOTSTRAP_URL = API + '/api/cs-widget/bootstrap';
  var MESSAGES_URL = API + '/api/cs-widget/messages';
  var STORAGE_KEY = 'geekclaw.widget.' + KEY;
  var POLL_MS = 3000;

  // ── 状态 ─────────────────────────────────────────────────────────
  var token = '';
  var agentName = 'GeekClaw 智能客服';
  var greeting = '';
  var messages = [];
  var opened = false;
  var booted = false;
  var booting = false;
  var sending = false;
  var pollTimer = null;
  var takenOver = false;

  try {
    var saved = localStorage.getItem(STORAGE_KEY);
    if (saved) token = saved;
  } catch (e) {
    /* 隐私模式下 localStorage 可能抛错，令牌不持久化即可 */
  }

  function persistToken(next) {
    token = next || '';
    try {
      if (token) localStorage.setItem(STORAGE_KEY, token);
      else localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      /* 忽略 */
    }
  }

  // ── 网络 ─────────────────────────────────────────────────────────
  // 统一走 ApiResponse 信封：{ success, data } 。`data` 为业务载荷。
  function api(url, options) {
    var opts = options || {};
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (opts.headers) {
      for (var k in opts.headers) {
        if (Object.prototype.hasOwnProperty.call(opts.headers, k)) headers[k] = opts.headers[k];
      }
    }
    return fetch(url, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'omit'
    }).then(function (res) {
      return res.json().catch(function () {
        return null;
      }).then(function (json) {
        if (!res.ok) {
          var err = (json && (json.error || json.message)) || ('请求失败（' + res.status + '）');
          throw new Error(err);
        }
        if (json && json.success === false) {
          throw new Error(json.error || json.message || '请求失败');
        }
        return json && 'data' in json ? json.data : json;
      });
    });
  }

  // ── 视图 ─────────────────────────────────────────────────────────
  var CLAW_SVG =
    '<svg viewBox="0 0 64 64" aria-hidden="true">' +
    '<circle cx="32" cy="32" r="32" fill="#E4393C"/>' +
    '<g fill="#fff">' +
    '<ellipse cx="32" cy="43" rx="11.5" ry="9"/>' +
    '<ellipse cx="16.5" cy="28.5" rx="4.6" ry="6.6" transform="rotate(-20 16.5 28.5)"/>' +
    '<ellipse cx="26" cy="21" rx="4.6" ry="7.2" transform="rotate(-8 26 21)"/>' +
    '<ellipse cx="38" cy="21" rx="4.6" ry="7.2" transform="rotate(8 38 21)"/>' +
    '<ellipse cx="47.5" cy="28.5" rx="4.6" ry="6.6" transform="rotate(20 47.5 28.5)"/>' +
    '</g></svg>';

  var STYLE =
    ':host{all:initial}' +
    '.gcw-root{position:fixed;right:20px;bottom:20px;z-index:2147483000;' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;' +
    'font-size:14px;line-height:1.5;color:#1f2329}' +
    '.gcw-bubble{width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;' +
    'box-shadow:0 6px 20px rgba(228,57,60,.35);padding:0;background:transparent;display:block}' +
    '.gcw-bubble svg{width:56px;height:56px;display:block}' +
    '.gcw-bubble:hover{transform:translateY(-2px);transition:transform .15s}' +
    '.gcw-panel{position:absolute;right:0;bottom:72px;width:360px;max-width:calc(100vw - 40px);' +
    'height:520px;max-height:calc(100vh - 120px);background:#fff;border-radius:14px;' +
    'box-shadow:0 12px 40px rgba(0,0,0,.18);display:flex;flex-direction:column;overflow:hidden}' +
    '.gcw-panel[hidden]{display:none}' +
    '.gcw-head{background:linear-gradient(135deg,#E4393C,#FF6A4D);color:#fff;padding:14px 16px;' +
    'display:flex;align-items:center;gap:10px;flex:0 0 auto}' +
    '.gcw-head svg{width:28px;height:28px;flex:0 0 auto}' +
    '.gcw-title{font-weight:600;font-size:15px}' +
    '.gcw-sub{font-size:12px;opacity:.85;margin-top:2px}' +
    '.gcw-close{margin-left:auto;background:transparent;border:0;color:#fff;font-size:20px;' +
    'cursor:pointer;line-height:1;padding:0 4px;opacity:.85}' +
    '.gcw-body{flex:1 1 auto;overflow-y:auto;padding:14px;background:#F7F8FA}' +
    '.gcw-msg{margin-bottom:12px;display:flex}' +
    '.gcw-msg.visitor{justify-content:flex-end}' +
    '.gcw-bubble-text{max-width:78%;padding:9px 12px;border-radius:12px;word-break:break-word;' +
    'white-space:pre-wrap;font-size:14px}' +
    '.gcw-msg.agent .gcw-bubble-text{background:#fff;color:#1f2329;border:1px solid #EDEEF0;' +
    'border-bottom-left-radius:4px}' +
    '.gcw-msg.visitor .gcw-bubble-text{background:#E4393C;color:#fff;border-bottom-right-radius:4px}' +
    '.gcw-tip{text-align:center;font-size:12px;color:#8A9099;margin:8px 0}' +
    '.gcw-foot{flex:0 0 auto;border-top:1px solid #EDEEF0;padding:10px;display:flex;gap:8px;background:#fff}' +
    '.gcw-input{flex:1 1 auto;border:1px solid #E3E5E8;border-radius:8px;padding:9px 11px;' +
    'font-size:14px;outline:none;resize:none;height:40px;font-family:inherit}' +
    '.gcw-input:focus{border-color:#E4393C}' +
    '.gcw-send{flex:0 0 auto;background:#E4393C;color:#fff;border:0;border-radius:8px;' +
    'padding:0 16px;cursor:pointer;font-size:14px;height:40px}' +
    '.gcw-send[disabled]{opacity:.5;cursor:not-allowed}' +
    '.gcw-error{color:#B5492F;background:#FFF1F0;border:1px solid #FFCCC7;padding:8px 10px;' +
    'border-radius:8px;font-size:12px;margin-bottom:10px}';

  var host = document.createElement('div');
  host.className = 'gcw-host';
  var shadow = host.attachShadow({ mode: 'open' });

  var styleEl = document.createElement('style');
  styleEl.textContent = STYLE;
  shadow.appendChild(styleEl);

  var root = document.createElement('div');
  root.className = 'gcw-root';
  shadow.appendChild(root);

  var panel = document.createElement('div');
  panel.className = 'gcw-panel';
  panel.setAttribute('hidden', '');
  panel.innerHTML =
    '<div class="gcw-head">' +
    CLAW_SVG +
    '<div><div class="gcw-title"></div><div class="gcw-sub"></div></div>' +
    '<button class="gcw-close" type="button" aria-label="关闭">&times;</button>' +
    '</div>' +
    '<div class="gcw-body"></div>' +
    '<div class="gcw-foot">' +
    '<textarea class="gcw-input" placeholder="输入消息…" rows="1"></textarea>' +
    '<button class="gcw-send" type="button">发送</button>' +
    '</div>';
  root.appendChild(panel);

  var bubble = document.createElement('button');
  bubble.className = 'gcw-bubble';
  bubble.type = 'button';
  bubble.setAttribute('aria-label', '打开客服对话');
  bubble.innerHTML = CLAW_SVG;
  root.appendChild(bubble);

  var titleEl = panel.querySelector('.gcw-title');
  var subEl = panel.querySelector('.gcw-sub');
  var bodyEl = panel.querySelector('.gcw-body');
  var inputEl = panel.querySelector('.gcw-input');
  var sendEl = panel.querySelector('.gcw-send');
  var closeEl = panel.querySelector('.gcw-close');

  function setError(text) {
    var prev = bodyEl.querySelector('.gcw-error');
    if (prev) prev.remove();
    if (!text) return;
    var box = document.createElement('div');
    box.className = 'gcw-error';
    box.textContent = text;
    bodyEl.appendChild(box);
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  function renderMessages() {
    setError('');
    var existing = bodyEl.querySelector('.gcw-msgs');
    var wrap = existing;
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'gcw-msgs';
      bodyEl.appendChild(wrap);
    }
    wrap.innerHTML = '';
    if (!messages.length && greeting) {
      var tip = document.createElement('div');
      tip.className = 'gcw-tip';
      tip.textContent = greeting;
      wrap.appendChild(tip);
    }
    messages.forEach(function (m) {
      var row = document.createElement('div');
      row.className = 'gcw-msg ' + (m.role === 'visitor' ? 'visitor' : 'agent');
      var text = document.createElement('div');
      text.className = 'gcw-bubble-text';
      text.textContent = m.content;
      row.appendChild(text);
      wrap.appendChild(row);
    });
    if (takenOver) {
      var note = document.createElement('div');
      note.className = 'gcw-tip';
      note.textContent = '已转人工客服，请稍候';
      wrap.appendChild(note);
    }
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  // ── 会话流程 ─────────────────────────────────────────────────────
  function bootstrap() {
    if (booting) return Promise.resolve();
    booting = true;
    return api(BOOTSTRAP_URL, {
      method: 'POST',
      body: { key: KEY, token: token || undefined }
    })
      .then(function (data) {
        persistToken(data.token);
        agentName = data.agent_name || agentName;
        greeting = data.greeting || '';
        messages = data.messages || [];
        takenOver = !!data.taken_over;
        titleEl.textContent = agentName;
        subEl.textContent = takenOver ? '人工客服为您服务' : 'AI 智能客服 · 在线';
        booted = true;
        renderMessages();
      })
      .catch(function (err) {
        // 令牌失效（会话被清理）时丢弃它，下次重新开一条。
        if (err && /失效|过期|无效/.test(err.message || '')) persistToken('');
        setError(err && err.message ? err.message : '暂时无法连接客服');
      })
      .then(function () {
        booting = false;
      });
  }

  function send() {
    var text = (inputEl.value || '').trim();
    if (!text || sending) return;
    sending = true;
    sendEl.disabled = true;
    setError('');

    // 乐观渲染：先把访客消息上屏，网络慢时不显得卡顿。
    messages.push({ role: 'visitor', content: text, created_at: Date.now() });
    inputEl.value = '';
    renderMessages();

    api(MESSAGES_URL, { method: 'POST', body: { text: text } })
      .then(function (data) {
        takenOver = !!data.taken_over;
        if (data.reply) {
          messages.push({ role: 'agent', content: data.reply, created_at: Date.now() });
        }
        renderMessages();
      })
      .catch(function (err) {
        setError(err && err.message ? err.message : '消息发送失败，请重试');
      })
      .then(function () {
        sending = false;
        sendEl.disabled = false;
        inputEl.focus();
      });
  }

  // 轮询：主要用于人工接管后把人工回复带回给访客；面板关闭时不轮询。
  function poll() {
    if (!booted || !opened || !token) return;
    api(MESSAGES_URL, { method: 'GET' })
      .then(function (list) {
        if (!list || list.length <= messages.length) return;
        messages = list;
        renderMessages();
      })
      .catch(function () {
        /* 轮询失败静默：下一轮再试，不打扰访客 */
      });
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(poll, POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function open() {
    opened = true;
    panel.removeAttribute('hidden');
    bubble.style.display = 'none';
    if (!booted) bootstrap();
    startPolling();
    inputEl.focus();
  }

  function close() {
    opened = false;
    panel.setAttribute('hidden', '');
    bubble.style.display = 'block';
    stopPolling();
  }

  bubble.addEventListener('click', open);
  closeEl.addEventListener('click', close);
  sendEl.addEventListener('click', send);
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  (document.body || document.documentElement).appendChild(host);

  // 显式入口：便于宿主页面在需要时关闭/唤起挂件。
  window.GeekClawWidget = {
    open: open,
    close: close,
    isOpen: function () {
      return opened;
    }
  };
})();
