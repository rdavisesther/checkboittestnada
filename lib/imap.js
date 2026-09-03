import { ImapFlow } from 'imapflow';

function extractAuth(msg) {
  const text = msg.source?.toString?.('utf8') || '';

  // The FIRST Received header hop is the one added by the sending SMTP server,
  // i.e. the IP that actually sent the message (the "tested from" IP).
  let testedIp = '';
  const firstReceived = text.match(/^received:\s*([^\r\n]*)/im);
  if (firstReceived) {
    const header = firstReceived[1];
    const ipMatch = header.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    if (ipMatch) {
      const ip = ipMatch[0];
      if (!/^0\.|^255\.|^127\.|^10\.|^192\.168\.|^169\.254\./.test(ip)) testedIp = ip;
    }
  }

  let spf = 'none';
  let dkim = 'none';
  let authHeader = '';
  const authHeaders = [...text.matchAll(/^authentication-results:\s*(.+)$/gim)];
  if (authHeaders.length) authHeader = authHeaders[authHeaders.length - 1][1];

  // SPF: prefer Received-SPF, fallback Authentication-Results
  const spfHeaders = [...text.matchAll(/^received-spf:\s*(.+)$/gim)];
  if (spfHeaders.length) {
    const h = spfHeaders[spfHeaders.length - 1][1];
    const m = h.match(/\b(pass|fail|softfail|neutral|none|temperror|permerror)\b/i);
    spf = m ? m[1].toLowerCase() : h.trim().slice(0, 40);
  } else {
    const sm = authHeader.match(/smtp\.mailfrom\s*=\s*(pass|fail|softfail|neutral|none)/i);
    spf = sm ? sm[1].toLowerCase() : 'none';
  }

  // DKIM: from Authentication-Results
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
