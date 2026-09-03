import { ImapFlow } from 'imapflow';

async function searchFolder(client, folder, subject, sinceMs) {
  try {
    const lock = await client.getMailboxLock(folder);
    try {
      const sinceDate = new Date(sinceMs - 60_000);
      const uids = await client.search({ since: sinceDate, subject });
      if (!uids.length) return null;

      for await (const msg of client.fetch(uids.slice(-5), {
        uid: true,
        envelope: true,
        internalDate: true,
        source: true
      })) {
        const received = msg.internalDate ? new Date(msg.internalDate).getTime() : 0;
        if (received && received < sinceMs - 60_000) continue;

        const envelopeSubject = (msg.envelope?.subject || '').trim();
        const source = msg.source?.toString('utf8') || '';
        const subjectHeader = (source.match(/^subject:\s*(.+)$/im)?.[1] || '').trim();

        const match = envelopeSubject === subject.trim() ||
          source.toLowerCase().includes(`subject: ${subject.trim().toLowerCase()}`);

        if (match) {
          return {
            uid: msg.uid,
            from: (msg.envelope?.from || []).map(x => x.address).filter(Boolean).join(', '),
            date: msg.internalDate || null,
            folder
          };
        }
      }
      return null;
    } finally {
      lock.release();
    }
  } catch {
    return null;
  }
}

export async function checkMailbox(box, subject, sinceMs) {
  if (!box.host || !box.user || !box.pass) {
    return { status: 'not_configured' };
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

    const inboxMatch = await searchFolder(client, inbox, subject, sinceMs);
    if (inboxMatch) {
      return { status: 'inbox', ...inboxMatch };
    }

    if (junk) {
      const spamMatch = await searchFolder(client, junk, subject, sinceMs);
      if (spamMatch) {
        return { status: 'spam', ...spamMatch };
      }
    }

    return { status: 'not_found' };
  } catch (err) {
    return { status: 'error', error: err.message };
  } finally {
    try { await client.logout(); } catch {}
  }
}
