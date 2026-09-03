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
let currentRows = [];

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
      <label>App Password <input id="b${n}_pass" type="password" placeholder="xxxx xxxx xxxx xxxx"></label>
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

  currentRows = [];
  let html = '';

  data.results.forEach((r, idx) => {
    if (!r.found || r.found.length === 0) {
      html += `
        <div class="mb-group">
          <div class="mb-title">Result Mailbox ${idx + 1} <span class="mb-mail">${esc(r.email)}</span></div>
          <div class="empty">No delivery info.</div>
        </div>`;
      return;
    }

    const rows = r.found.map(m => {
      const row = {
        mailbox: r.email,
        subject: m.subject || '',
        location: m.location,
        spf: m.spf || 'none',
        dkim: m.dkim || 'none',
        ip: (m.ip && m.ip[0]) || ''
      };
      currentRows.push(row);
      return row;
    });

    html += `
      <div class="mb-group">
        <div class="mb-title">Result Mailbox ${idx + 1} <span class="mb-mail">${esc(r.email)}</span></div>
        <div class="tbl-scroll">
          <table class="tbl">
            <thead>
              <tr><th>Subject</th><th>Inbox / Spam</th><th>SPF</th><th>DKIM</th><th>IP Received</th></tr>
            </thead>
            <tbody>
              ${rows.map(row => `
                <tr>
                  <td class="td-subject">${esc(row.subject)}</td>
                  <td><span class="loc ${row.location === 'spam' ? 'spam' : 'inbox'}">${row.location === 'spam' ? 'SPAM' : 'INBOX'}</span></td>
                  <td><span class="chip ${passClass(row.spf)}">${esc(row.spf)}</span></td>
                  <td><span class="chip ${passClass(row.dkim)}">${esc(row.dkim)}</span></td>
                  <td class="td-ip">${esc(row.ip) || 'n/a'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  });

  $('results').innerHTML = html || '<div class="empty">No results.</div>';

  updateCopyState();
}

function exportCsv() {
  if (!currentRows || currentRows.length === 0) return;
  const header = ['Mailbox', 'Subject', 'Inbox/Spam', 'SPF', 'DKIM', 'IP Received'];
  const lines = [header];
  for (const row of currentRows) {
    lines.push([
      `"${(row.mailbox || '').replace(/"/g, '""')}"`,
      `"${(row.subject || '').replace(/"/g, '""')}"`,
      row.location,
      row.spf,
      row.dkim,
      `"${row.ip}"`
    ].join(','));
  }
  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `inbox-results-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function passClass(v) {
  const s = String(v || '').toLowerCase();
  if (s === 'pass') return 'ok';
  if (s === 'fail' || s === 'softfail' || s === 'permerror' || s === 'temperror') return 'fail';
  return 'none';
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[c]));
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
$('exportCsv').addEventListener('click', exportCsv);
$('copyInbox').addEventListener('click', () => copyText(collectIps('inbox').join('\n'), $('copyInbox')));
$('copySpam').addEventListener('click', () => copyText(collectIps('spam').join('\n'), $('copySpam')));
loadConfig();
