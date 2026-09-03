const $ = id => document.getElementById(id);
let currentTestId = null;
let timer = null;

const labels = {
  sending: 'Sending',
  sent: 'Sent / checking',
  inbox: 'Inbox',
  spam: 'Spam / Junk',
  waiting: 'Waiting',
  not_received: 'Not received',
  not_configured: 'Not configured',
  error: 'Error',
  send_error: 'Send error'
};

async function loadMailboxes() {
  const res = await fetch('/api/mailboxes');
  const boxes = await res.json();
  $('mailboxes').innerHTML = boxes.map(b => `
    <div class="mailbox">
      <div>
        <strong>${escapeHtml(b.email)}</strong>
        <small>${b.configured ? 'IMAP monitoring ready' : 'IMAP credentials not configured'}</small>
      </div>
      <span class="badge ${b.configured ? 'ok' : ''}">
        ${b.configured ? 'Ready' : 'Setup'}
      </span>
    </div>
  `).join('');
}

async function sendTest() {
  const subject = $('subject').value.trim();
  const html = $('html').value.trim();

  if (!subject || !html) {
    $('message').textContent = 'Subject and HTML are required.';
    return;
  }

  $('send').disabled = true;
  $('message').textContent = 'Sending...';

  try {
    const res = await fetch('/api/test', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ subject, html })
    });

    const data = await res.json();
    if (!res.ok && !data.id) throw new Error(data.error || 'Send failed.');

    currentTestId = data.id;
    $('message').textContent = `Test started. ID: ${data.id}`;
    render(data);
    startPolling();
  } catch (e) {
    $('message').textContent = e.message;
  } finally {
    $('send').disabled = false;
  }
}

async function refresh() {
  if (!currentTestId) return;
  const res = await fetch(`/api/test?id=${encodeURIComponent(currentTestId)}`);
  if (!res.ok) return;
  const data = await res.json();
  render(data);

  const done = data.results.every(r =>
    ['inbox','spam','not_received','error','not_configured','send_error'].includes(r.status)
  );

  if (done) stopPolling();
}

function startPolling() {
  stopPolling();
  timer = setInterval(refresh, 4000);
}

function stopPolling() {
  if (timer) clearInterval(timer);
  timer = null;
}

function render(test) {
  $('results').innerHTML = `
    <div class="meta">Test ID: ${escapeHtml(test.id)} · ${new Date(test.createdAt).toLocaleString()}</div>
    ${test.results.map(r => `
      <div class="result">
        <div class="result-top">
          <strong>${escapeHtml(r.mailbox)}</strong>
          <span class="status ${escapeHtml(r.status)}">${labels[r.status] || escapeHtml(r.status)}</span>
        </div>
        ${r.folder ? `<div class="meta">Folder: ${escapeHtml(r.folder)}</div>` : ''}
        ${r.error ? `<div class="meta">${escapeHtml(r.error)}</div>` : ''}
        ${['sending','sent','waiting'].includes(r.status) ? '<div class="bar"><div></div></div>' : ''}
      </div>
    `).join('')}
  `;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[c]));
}

$('send').addEventListener('click', sendTest);
loadMailboxes();
