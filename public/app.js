const $ = id => document.getElementById(id);

const statusLabels = {
  inbox: 'Inbox',
  spam: 'Spam / Junk',
  not_found: 'Not found',
  not_configured: 'Not configured',
  error: 'Error'
};

function saveConfig() {
  const config = {};
  for (const n of [1, 2]) {
    config[`box${n}`] = {
      email: $(`b${n}_email`).value.trim(),
      host: $(`b${n}_host`).value.trim(),
      port: Number($(`b${n}_port`).value) || 993,
      secure: $(`b${n}_secure`).checked,
      user: $(`b${n}_user`).value.trim(),
      pass: $(`b${n}_pass`).value
    };
  }
  try {
    localStorage.setItem('imap_config', JSON.stringify(config));
  } catch {}
}

function loadConfig() {
  try {
    const raw = localStorage.getItem('imap_config');
    if (!raw) return;
    const config = JSON.parse(raw);
    if (!config || typeof config !== 'object') return;
    for (const n of [1, 2]) {
      const b = config[`box${n}`];
      if (!b || typeof b !== 'object') continue;
      if (b.email) $(`b${n}_email`).value = b.email;
      if (b.host) $(`b${n}_host`).value = b.host;
      if (b.port) $(`b${n}_port`).value = b.port;
      $(`b${n}_secure`).checked = b.secure !== false;
      if (b.user) $(`b${n}_user`).value = b.user;
      if (b.pass) $(`b${n}_pass`).value = b.pass;
    }
  } catch {
    try { localStorage.removeItem('imap_config'); } catch {}
  }
}

function getConfig() {
  saveConfig();
  const boxes = [];
  for (const n of [1, 2]) {
    const email = $(`b${n}_email`).value.trim();
    const host = $(`b${n}_host`).value.trim();
    const user = $(`b${n}_user`).value.trim();
    const pass = $(`b${n}_pass`).value;
    if (email && host && user && pass) {
      boxes.push({
        email,
        host,
        port: Number($(`b${n}_port`).value) || 993,
        secure: $(`b${n}_secure`).checked,
        user,
        pass
      });
    }
  }
  return boxes;
}

async function check() {
  const subject = $('subject').value.trim();
  if (!subject) {
    $('message').textContent = 'Enter a subject to search.';
    return;
  }

  const hours = Math.max(1, Number($('hours').value) || 24);

  const mailboxes = getConfig();
  if (mailboxes.length === 0) {
    $('message').textContent = 'Configure at least one mailbox.';
    return;
  }

  $('check').disabled = true;
  $('message').textContent = 'Checking...';
  $('results').innerHTML = '<div class="empty">Searching mailboxes...</div>';

  try {
    const res = await fetch('/api/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mailboxes, subject, hours })
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
    <div class="meta">Subject: ${esc(data.subject)} · Last ${esc(data.hours)}h · ${new Date(data.checkedAt).toLocaleString()}</div>
    ${data.results.map(r => {
      const label = r.status === 'spam' ? 'Spam / Junk' : r.status === 'inbox' ? 'Inbox' : statusLabels[r.status] || r.status;
      const countEl = r.count !== undefined ? `<div class="meta"><strong>${r.count}</strong> match(es) found</div>` : '';
      const list = (r.found && r.found.length) ? `
        <div class="match-list">
          ${r.found.map(m => `
            <div class="match">
              <div>${esc(m.folder)}</div>
              <div>${m.date ? new Date(m.date).toLocaleString() : ''}</div>
              <div>${m.from ? 'From: ' + esc(m.from) : ''}</div>
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

for (const el of document.querySelectorAll('input, textarea')) {
  el.addEventListener('change', saveConfig);
}

$('check').addEventListener('click', check);
loadConfig();
