import { ImapFlow } from 'imapflow';

function extractIPs(source) {
  const text = source?.toString?.('utf8') || '';
  const ips = new Set();

  const receivedHeaders = [...text.matchAll(/^received:\s*([\s\S]*?)(?=^[a-z][a-z0-9\-]*:\s|\r\n\r\n)/gim)];
    for (const m of receivedHeaders) {
      const header = m[1] || '';

    for (const ipMatch of header.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
      const ip = ipMatch[0];
      if (!/^0\.|^255\.|^127\.|^10\.|^192\.168\.|^169\.254\./.test(ip)) {
        ips.add(ip);
      }
    }
  }

  // fallback: any IP in the whole raw source
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

async function fetchFolder(client, folder, subject, sinceMs, fromFilter) {
  try {
    const lock = await client.getMailboxLock(folder);
    try {
      const sinceDate = new Date(sinceMs - 60_000);
      const searchCriteria = { since: sinceDate, subject };
      if (fromFilter) searchCriteria.from = fromFilter;

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
        if (envelopeSubject !== subject.trim()) continue;

        const fromAddresses = (msg.envelope?.from || [])
          .map(x => x.address || '')
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        const fromNames = (msg.envelope?.from || [])
          .map(x => x.name || '')
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        if (fromFilter && !fromAddresses.includes(fromFilter.toLowerCase()) && !fromNames.includes(fromFilter.toLowerCase())) {
          continue;
        }

        matches.push({
          uid: msg.uid,
          folder,
          from: (msg.envelope?.from || []).map(x => x.address).filter(Boolean).join(', '),
          date: msg.internalDate ? msg.internalDate.toISOString() : null,
          ip: extractIPs(msg.source)
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

    const found = await fetchFolder(client, inbox, subject, sinceMs, fromFilter);
    const total = found.length;

    if (junk && total === 0) {
      const junkMatches = await fetchFolder(client, junk, subject, sinceMs, fromFilter);
      if (junkMatches.length) {
        return {
          status: 'spam',
          folder: junk,
          count: junkMatches.length,
          found: junkMatches
        };
      }
    }

    if (total > 0) {
      return { status: 'inbox', folder: inbox, count: total, found };
    }

    return { status: 'not_found', found: [] };
  } catch (err) {
    return { status: 'error', error: err.message, found: [] };
  } finally {
    try { await client.logout(); } catch {}
  }
}
