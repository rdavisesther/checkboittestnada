const $ = id => document.getElementById(id);

const statusLabels = {
  inbox: 'Inbox',
  spam: 'Spam / Junk',
  not_found: 'Not found',
  not_configured: 'Not configured',
  error: 'Error'
};

let boxCount = 0;

function boxFields(n) {
  return {
    email: $(`b${n}_email`),
    host: $(`b${n}_host`),
    port: $(`b${n}_port`),
    secure: $(`b${n}_secure`),
    user: $(`b${n}_user`),
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
      ${n > 1 ? `<button type="button" class="ghost remove" onclick="removeBox(${n})">Remove</button>` : ''}
    </div>
    <div class="form-grid">
      <label>Email <input id="b${n}_email" type="email" placeholder="user@gmail.com"></label>
      <label>IMAP Host <input id="b${n}_host" type="text" placeholder="imap.gmail.com"></label>
      <label>Port <input id="b${n}_port" type="number" value="993"></label>
      <label class="checkline"><input id="b${n}_secure" type="checkbox" checked> SSL/TLS</label>
      <label>Username <input id="b${n}_user" type="text" placeholder="user@gmail.com"></label>
      <label>Password / App Password <input id="b${n}_pass" type="password" placeholder="xxxx xxxx xxxx xxxx"></label>
    </div>
  `;
  document.getElementById('boxes').appendChild(wrap);

  const c = boxFields(n);
  if (config.email) c.email.value = config.email;
  if (config.host) c.host.value = config.host;
  if (config.port) c.port.value = config.port;
  if (config.user) c.user.value = config.user;
  if (config.pass) c.pass.value = config.pass;
  c.secure.checked = config.secure !== false;

  for (const key of ['email','host','port','secure','user','pass']) {
    c[key].addEventListener('change', saveConfig);
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
    boxes.push({
      n,
      email: c.email.value.trim(),
      host: c.host.value.trim(),
      port: Number(c.port.value) || 993,
      secure: c.secure.checked,
      user: c.user.value.trim(),
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
    .filter(b => b.email && b.host && b.user && b.pass)
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

  const minutes = Math.max(1, Number($('minutes').value) || 1440);
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
    $('message').textContent = `Checked at ${new Date(data.checkedAt).toLocaleTimeString()}`;
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

$('addBox').addEventListener('click', () => addBox({}));
$('check').addEventListener('click', check);
loadConfig();
