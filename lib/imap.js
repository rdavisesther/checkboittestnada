import { ImapFlow } from 'imapflow';

function extractAuth(msg) {
  const text = msg.source?.toString?.('utf8') || '';

  // ---- Gather authentication headers first ----
  let authHeader = '';
  const authHeaders = [...text.matchAll(/^authentication-results:\s*(.+)$/gim)];
  if (authHeaders.length) authHeader = authHeaders[authHeaders.length - 1][1];

  let spfHeader = '';
  const spfHeaders = [...text.matchAll(/^received-spf:\s*(.+)$/gim)];
  if (spfHeaders.length) spfHeader = spfHeaders[spfHeaders.length - 1][1];

  // ---- SPF status ----
  let spf = 'none';
  if (spfHeader) {
    const m = spfHeader.match(/\b(pass|fail|softfail|neutral|none|temperror|permerror)\b/i);
    spf = m ? m[1].toLowerCase() : spfHeader.trim().slice(0, 40);
  } else {
    const sm = authHeader.match(/smtp\.mailfrom\s*=\s*(pass|fail|softfail|neutral|none)/i);
    spf = sm ? sm[1].toLowerCase() : 'none';
  }

  // ---- The tested IP = client-ip from Received-SPF (highest priority) ----
  let testedIp = '';
  if (spfHeader) {
    const cip = spfHeader.match(/client-ip=(\d{1,3}(?:\.\d{1,3}){3})/i);
    if (cip) testedIp = cip[1];
    else {
      const desig = spfHeader.match(/designates\s+(\d{1,3}(?:\.\d{1,3}){3})/i);
      if (desig) testedIp = desig[1];
    }
  }

  // ---- Fallbacks if SPF client-ip not found ----
  // From the FIRST Received header block (sending SMTP server).
  if (!testedIp) {
    const firstReceived = text.match(/^received:\s*([\s\S]*?)(?=^[a-z][a-z0-9\-]*:\s|\r\n\r\n)/im);
    if (firstReceived && firstReceived[1]) {
      const block = firstReceived[1];
      let ip = null;
      const bracketIp = block.match(/\[\s*(\d{1,3}(?:\.\d{1,3}){3})\s*\]/);
      if (bracketIp) ip = bracketIp[1];
      if (!ip) {
        const fromIp = block.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
        if (fromIp) ip = fromIp[1];
      }
      if (ip && !/^0\.|^255\.|^127\.|^10\.|^192\.168\.|^169\.254\./.test(ip)) testedIp = ip;
    }
  }

  // IPv6 sender IP.
  if (!testedIp) {
    const v6 = text.match(/^received:\s*from\s+[^\r\n]*\[\s*([0-9a-f:]+)\s*\]/im);
    if (v6) testedIp = v6[1];
  }

  // X-Originating-IP
  if (!testedIp) {
    const xip = text.match(/^x-originating-ip:\s*\[?(\d{1,3}(?:\.\d{1,3}){3})\]?/im);
    if (xip) testedIp = xip[1];
  }

  // DKIM: from Authentication-Results
  let dkim = 'none';
  const dkm = authHeader.match(/dkim\s*=\s*(pass|fail|none|temperror|permerror)/i);
  dkim = dkm ? dkm[1].toLowerCase() : 'none';

  // Sender/domain
  const envFrom = (msg.envelope?.from || [])[0] || {};
  const sender = envFrom.address || '';
  let domain = '';
  if (sender.includes('@')) domain = sender.split('@')[1].toLowerCase();
  else {
    const dm = authHeader.match(/header\.d=([\w.\-]+)/i);
    if (dm) domain = dm[1].toLowerCase();
  }

  return {
    ip: testedIp ? [testedIp] : [],
    spf,
    dkim,
    sender,
    domain,
    from: (msg.envelope?.from || []).map(x => x.address).filter(Boolean).join(', '),
    subject: (msg.envelope?.subject || '').trim(),
    date: msg.internalDate ? new Date(msg.internalDate).toISOString() : null
  };
}

function matchesFrom(msg, envelopeFrom, envelopeNames, fromFilter) {
  const haystack = `${envelopeFrom} ${envelopeNames}`.toLowerCase();
  const filter = String(fromFilter || '').toLowerCase();
  return !filter || haystack.includes(filter);
}

async function fetchFolder(client, folder, subject, sinceMs, fromFilter) {
  try {
    const lock = await client.getMailboxLock(folder);
    try {
      const sinceDate = new Date(sinceMs - 60_000);
      const searchCriteria = { since: sinceDate };

      if (subject && fromFilter) {
        searchCriteria.subject = subject;
        searchCriteria.from = fromFilter;
      } else if (subject) {
        searchCriteria.subject = subject;
      } else if (fromFilter) {
        searchCriteria.from = fromFilter;
      }

      const uids = await client.search(searchCriteria);
      if (!uids.length) return [];

      const matches = [];
      for await (const msg of client.fetch(uids, {
        uid: true,
        envelope: true,
        internalDate: true,
        source: true
      })) {
        const received = msg.internalDate ? new Date(msg.internalDate).getTime() : 0;
        if (received && received < sinceMs - 60_000) continue;

        const envelopeSubject = (msg.envelope?.subject || '').trim();
        if (subject && envelopeSubject !== subject.trim()) continue;

        const fromAddresses = (msg.envelope?.from || [])
          .map(x => x.address || '')
          .filter(Boolean)
          .join(' ');

        const fromNames = (msg.envelope?.from || [])
          .map(x => x.name || '')
          .filter(Boolean)
          .join(' ');

        if (fromFilter && !matchesFrom(msg, fromAddresses, fromNames, fromFilter)) continue;

        matches.push({
          uid: msg.uid,
          folder,
          ...extractAuth(msg)
        });
      }
      return matches;
    } finally {
      lock.release();
    }
  } catch {
    return [];
  }
}

export async function testConnection(box) {
  if (!box.host || !box.user || !box.pass) {
    return { ok: false, error: 'Host, username and password are required.' };
  }

  const client = new ImapFlow({
    host: box.host,
    port: Number(box.port || 993),
    secure: box.secure !== false,
    auth: { user: box.user, pass: box.pass },
    logger: false
  });

  try {
    await client.connect();
    const folders = await client.list();
    const inbox = folders.find(f => f.path.toUpperCase() === 'INBOX');
    return { ok: true, account: box.email || box.user };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    try { await client.logout(); } catch {}
  }
}

export async function checkMailbox(box, subject, sinceMs, fromFilter = '') {
  if (!box.host || !box.user || !box.pass) {
    return { status: 'not_configured', found: [] };
  }

  const client = new ImapFlow({
    host: box.host,
    port: Number(box.port || 993),
    secure: box.secure !== false,
    auth: { user: box.user, pass: box.pass },
    logger: false
  });

  try {
    await client.connect();
    const folders = await client.list();

    const inbox = folders.find(f => f.path.toUpperCase() === 'INBOX')?.path || 'INBOX';
    const junk =
      folders.find(f => f.specialUse === '\\Junk')?.path ||
      folders.find(f => /spam|junk/i.test(f.path))?.path;

    const inboxMatches = await fetchFolder(client, inbox, subject, sinceMs, fromFilter);
    const spamMatches = junk
      ? await fetchFolder(client, junk, subject, sinceMs, fromFilter)
      : [];

    const found = [
      ...inboxMatches.map(m => ({ ...m, location: 'inbox' })),
      ...spamMatches.map(m => ({ ...m, location: 'spam' }))
    ];

    if (found.length === 0) {
      return { status: 'not_found', found: [] };
    }

    const inboxCount = inboxMatches.length;
    const spamCount = spamMatches.length;

    return {
      status: inboxCount > 0 ? 'inbox' : 'spam',
      inbox: inboxCount,
      spam: spamCount,
      count: found.length,
      found
    };
  } catch (err) {
    return { status: 'error', error: err.message, found: [] };
  } finally {
    try { await client.logout(); } catch {}
  }
}
