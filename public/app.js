const $ = id => document.getElementById(id);

const statusLabels = {
  inbox: 'Inbox',
  spam: 'Spam / Junk',
  not_found: 'Not found',
  not_configured: 'Not configured',
  error: 'Error'
};

let boxCount = 0;
let lastResults = null;

function gmailDefaults(email) {
  return {
    email: email || '',
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    user: email || '',
    pass: ''
  };
}

function boxFields(n) {
  return {
    email: $(`b${n}_email`),
    pass: $(`b${n}_pass`)
  };
}

function addBox(config = {}) {
  boxCount++;
  const n = boxCount;
  const wrap = document.createElement('div');
  wrap.className = 'box-card';
  wrap.id = `box_${n}`;
  wrap.innerHTML = `
    <div class="box-head">
      <div class="box-title">IMAP Mailbox ${n}</div>
      <div>
        <button type="button" class="ghost minimal testBtn" onclick="testCnx(${n})">Test connection</button>
        ${n > 1 ? `<button type="button" class="ghost remove" onclick="removeBox(${n})">Remove</button>` : ''}
      </div>
    </div>
    <div class="cnx-status" id="cnx_${n}"></div>
    <div class="form-grid">
      <label>Email <input id="b${n}_email" type="email" placeholder="user@gmail.com"></label>
      <label>Password / App Password <input id="b${n}_pass" type="password" placeholder="xxxx xxxx xxxx xxxx"></label>
    </div>
  `;
  document.getElementById('boxes').appendChild(wrap);

  const defaults = gmailDefaults(config.email || '');
  const c = boxFields(n);
  c.email.value = defaults.email;
  if (config.pass) c.pass.value = config.pass;
  else if (defaults.pass) c.pass.value = defaults.pass;

  c.email.addEventListener('change', saveConfig);
  c.pass.addEventListener('change', saveConfig);
}

async function testCnx(n) {
  const c = boxFields(n);
  const email = c.email.value.trim();
  const pass = c.pass.value;
  const defaults = gmailDefaults(email);
  const statusEl = document.getElementById(`cnx_${n}`);

  if (!email || !pass) {
    statusEl.className = 'cnx-status err';
    statusEl.textContent = 'Fill email and password first.';
    return;
  }

  statusEl.className = 'cnx-status';
  statusEl.textContent = 'Testing connection...';

  try {
    const res = await fetch('/api/test-cnx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: defaults.host, port: defaults.port, secure: true, user: email, pass
      })
    });
    const data = await res.json();

    if (data.ok) {
      statusEl.className = 'cnx-status ok';
      statusEl.textContent = `Connected ✓ (${data.account})`;
    } else {
      statusEl.className = 'cnx-status err';
      statusEl.textContent = 'Connection failed: ' + (data.error || 'unknown error');
    }
  } catch (e) {
    statusEl.className = 'cnx-status err';
    statusEl.textContent = 'Error: ' + e.message;
  }
}

function removeBox(n) {
  const el = document.getElementById(`box_${n}`);
  if (el) el.remove();
  saveConfig();
}

function getAllBoxes() {
  const boxes = [];
  for (let n = 1; n <= boxCount; n++) {
    const el = document.getElementById(`b${n}_email`);
    if (!el) continue;
    const c = boxFields(n);
    const email = c.email.value.trim();
    boxes.push({
      n,
      email,
      ...gmailDefaults(email),
      pass: c.pass.value
    });
  }
  return boxes;
}

function saveConfig() {
  const list = getAllBoxes();
  try {
    localStorage.setItem('imap_boxes', JSON.stringify(list));
  } catch {}
}

function loadConfig() {
  let list = [];
  try {
    const raw = localStorage.getItem('imap_boxes');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    }
  } catch {
    try { localStorage.removeItem('imap_boxes'); } catch {}
  }

  if (list.length === 0) {
    addBox({});
    addBox({});
    return;
  }
  list.forEach(b => {
    const box = b && typeof b === 'object' ? b : {};
    if (b && Object.keys(box).length) {
      addBox(box);
    } else {
      addBox({});
    }
  });
}

function getConfig() {
  saveConfig();
  return getAllBoxes()
    .filter(b => b.email && b.pass)
    .map(b => ({
      email: b.email,
      host: b.host,
      port: b.port,
      secure: b.secure,
      user: b.user,
      pass: b.pass
    }));
}

async function check() {
  const subject = $('subject').value.trim();
  const from = $('from').value.trim();
  if (!subject && !from) {
    $('message').textContent = 'Enter a subject, a from address, or both.';
    return;
  }

  const minutes = Math.max(1, Number($('minutes').value) || 4);
  const mailboxes = getConfig();

  $('check').disabled = true;
  $('message').textContent = 'Checking...';
  $('results').innerHTML = '<div class="empty">Searching mailboxes...</div>';

  try {
    const res = await fetch('/api/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mailboxes, subject, minutes, from })
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Server returned invalid response. Check if the API is deployed correctly.');
    }

    if (!res.ok) throw new Error(data.error || 'Check failed.');

    renderResults(data);
    lastResults = data;
    $('message').textContent = `Checked at ${new Date(data.checkedAt).toLocaleTimeString()}`;
    updateCopyState();
  } catch (e) {
    $('message').textContent = e.message;
    $('results').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  } finally {
    $('check').disabled = false;
  }
}

function renderResults(data) {
  if (!data.results || data.results.length === 0) {
    $('results').innerHTML = '<div class="empty">No results.</div>';
    return;
  }

  $('results').innerHTML = `
    <div class="meta">Subject: ${esc(data.subject)}${data.from ? ' · From: ' + esc(data.from) : ''} · Last ${esc(data.minutes)} min · ${new Date(data.checkedAt).toLocaleString()}</div>
    ${data.results.map(r => {
      const label = r.status === 'spam' ? 'Spam / Junk' : r.status === 'inbox' ? 'Inbox' : statusLabels[r.status] || r.status;
      const boxCounts = (r.inbox !== undefined || r.spam !== undefined) ? `
        <div class="meta"><strong>${r.inbox || 0}</strong> in Inbox · <strong>${r.spam || 0}</strong> in Spam</div>
      ` : '';
      const countEl = r.count !== undefined ? `<div class="meta">${r.count} match(es) found</div>` : '';
      const list = (r.found && r.found.length) ? `
        <div class="match-list">
          ${r.found.map(m => `
            <div class="match">
              <div><span class="loc ${m.location === 'spam' ? 'spam' : 'inbox'}">${m.location === 'spam' ? 'SPAM' : 'INBOX'}</span> ${esc(m.subject)}</div>
              <div>${m.date ? new Date(m.date).toLocaleString() : ''}</div>
              <div>From: ${esc(m.from)}</div>
              <div class="spf-row">${spfBadge(m.spf)}</div>
              ${(m.ip && m.ip.length) ? `<div class="ips">IP: ${m.ip.map(ip => esc(ip)).join(' · ')}</div>` : ''}
            </div>
          `).join('')}
        </div>
      ` : '';
      return `
        <div class="result">
          <div class="result-top">
            <strong>${esc(r.email)}</strong>
            <span class="status ${esc(r.status)}">${esc(label)}</span>
          </div>
          ${boxCounts}
          ${countEl}
          ${list}
          ${r.error ? `<div class="meta error">${esc(r.error)}</div>` : ''}
        </div>
      `;
    }).join('')}
  `;
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[c]));
}

function spfBadge(spf) {
  if (!spf) return '<span class="spf none">SPF: n/a</span>';
  const s = String(spf);
  const pass = /pass/i.test(s);
  const fail = /fail/i.test(s);
  const cls = pass ? 'pass' : fail ? 'fail' : 'none';
  return `<span class="spf ${cls}">SPF: ${esc(spf)}</span>`;
}

function collectIps(location) {
  if (!lastResults) return [];
  const ips = new Set();
  for (const r of lastResults.results) {
    if (!r.found) continue;
    for (const m of r.found) {
      if (m.location !== location) continue;
      for (const ip of (m.ip || [])) ips.add(ip);
    }
  }
  return [...ips];
}

function copyText(text, btn) {
  navigator.clipboard?.writeText(text).then(() => {
    const prev = btn.textContent;
    btn.textContent = 'Copied ✓';
    setTimeout(() => { btn.textContent = prev; }, 1500);
  }).catch(() => {});
}

function updateCopyState() {
  if (!lastResults) return;
  const inboxIps = collectIps('inbox').length;
  const spamIps = collectIps('spam').length;
  $('copyInbox').textContent = inboxIps ? `Copy Inbox IPs (${inboxIps})` : 'Copy Inbox IPs';
  $('copySpam').textContent = spamIps ? `Copy Spam IPs (${spamIps})` : 'Copy Spam IPs';
  $('copyInbox').disabled = inboxIps === 0;
  $('copySpam').disabled = spamIps === 0;
}

$('addBox').addEventListener('click', () => addBox({}));
$('check').addEventListener('click', check);
$('copyInbox').addEventListener('click', () => copyText(collectIps('inbox').join('\n'), $('copyInbox')));
$('copySpam').addEventListener('click', () => copyText(collectIps('spam').join('\n'), $('copySpam')));
loadConfig();
