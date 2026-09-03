import { ImapFlow } from 'imapflow';

async function fetchFolder(client, folder, subject, sinceMs) {
  try {
    const lock = await client.getMailboxLock(folder);
    try {
      const sinceDate = new Date(sinceMs - 60_000);
      const uids = await client.search({ since: sinceDate, subject });
      if (!uids.length) return [];

      const matches = [];
      for await (const msg of client.fetch(uids, {
        uid: true,
        envelope: true,
        internalDate: true
      })) {
        const received = msg.internalDate ? new Date(msg.internalDate).getTime() : 0;
        if (received && received < sinceMs - 60_000) continue;

        const envelopeSubject = (msg.envelope?.subject || '').trim();
        if (envelopeSubject === subject.trim()) {
          matches.push({
            uid: msg.uid,
            folder,
            from: (msg.envelope?.from || []).map(x => x.address).filter(Boolean).join(', '),
            date: msg.internalDate ? msg.internalDate.toISOString() : null
          });
        }
      }
      return matches;
    } finally {
      lock.release();
    }
  } catch {
    return [];
  }
}

export async function checkMailbox(box, subject, sinceMs) {
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

    const found = await fetchFolder(client, inbox, subject, sinceMs);
    const total = found.length;

    if (junk && total === 0) {
      const junkMatches = await fetchFolder(client, junk, subject, sinceMs);
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
