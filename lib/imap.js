import { ImapFlow } from 'imapflow';

function extractIPs(source) {
  const text = source?.toString?.('utf8') || '';
  const ips = new Set();

  const receivedHeaders = [...text.matchAll(/^received:\s*([\s\S]*?)(?=^[a-z][a-z0-9\-]*:\s|\r\n\r\n)/gim)];
  for (const m of receivedHeaders) {
    const header = m[1] || '';
    for (const ipMatch of header.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
      const ip = ipMatch[0];
      if (!/^0\.|^255\.|^127\.|^10\.|^192\.168\.|^169\.254\.|^::|^fe80/.test(ip)) {
        ips.add(ip);
      }
    }
  }

  if (ips.size === 0) {
    for (const ipMatch of text.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
      const ip = ipMatch[0];
      if (!/^0\.|^255\.|^127\.|^10\.|^192\.168\.|^169\.254\./.test(ip)) {
        ips.add(ip);
      }
    }
  }

  return [...ips];
}

function extractSpf(source) {
  const text = source?.toString?.('utf8') || '';
  let spf = null;

  // Look at the Received-SPF header of the last hop that has one
  const spfHeaders = [...text.matchAll(/^received-spf:\s*(.+)$/gim)];
  if (spfHeaders.length) {
    spf = spfHeaders[spfHeaders.length - 1][1].trim();
  }

  // fallback: search Authentication-Results for spf result
  if (!spf) {
    const auth = [...text.matchAll(/^authentication-results:\s*(.+)$/gim)];
    for (const a of auth) {
      const smtpmail = a[1].match(/smtp\.mailfrom\s*=\s*(pass|fail|softfail|neutral|none|temperror|permerror)/i);
      if (smtpmail) {
        spf = `smtp.mailfrom=${smtpmail[1].toLowerCase()}`;
        break;
      }
      const spfM = a[1].match(/spf\s*=\s*(pass|fail|softfail|neutral|none|temperror|permerror)/i);
      if (spfM) {
        spf = `spf=${spfM[1].toLowerCase()}`;
        break;
      }
    }
  }

  return spf;
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
          subject: envelopeSubject,
          from: (msg.envelope?.from || []).map(x => x.address).filter(Boolean).join(', '),
          date: msg.internalDate ? msg.internalDate.toISOString() : null,
          ip: extractIPs(msg.source),
          spf: extractSpf(msg.source)
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
