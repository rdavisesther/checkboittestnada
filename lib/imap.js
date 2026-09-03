import { ImapFlow } from 'imapflow';

async function findMessage(client, folder, subject, expectedSender, sinceMs) {
  try {
    const lock = await client.getMailboxLock(folder);
    try {
      const sinceDate = new Date(sinceMs - 60_000);
      const uids = await client.search({ since: sinceDate, subject });

      if (!uids.length) return false;

      for await (const msg of client.fetch(uids.slice(-10), {
        uid: true,
        envelope: true,
        internalDate: true,
        source: true
      })) {
        const received = msg.internalDate ? new Date(msg.internalDate).getTime() : 0;
        if (received && received < sinceMs - 60_000) continue;

        const envelopeFrom = (msg.envelope?.from || [])
          .map(x => x.address || '')
          .filter(Boolean)
          .join(',')
          .toLowerCase();

        const source = msg.source?.toString('utf8') || '';
        const fromHeader = (source.match(/^from:\s*(.+)$/im)?.[1] || '').toLowerCase();

        const senderOk = !expectedSender ||
          envelopeFrom.includes(expectedSender.toLowerCase()) ||
          fromHeader.includes(expectedSender.toLowerCase());

        const subjectOk = (msg.envelope?.subject || '').trim() === subject.trim() ||
          source.toLowerCase().includes(`subject: ${subject.trim().toLowerCase()}`);

        if (senderOk && subjectOk) return true;
      }
      return false;
    } finally {
      lock.release();
    }
  } catch {
    return false;
  }
}

export async function checkMailbox(box, subject, sinceMs) {
  if (!box.host || !box.user || !box.pass) {
    return { status: 'not_configured', checkedAt: new Date().toISOString() };
  }

  const client = new ImapFlow({
    host: box.host,
    port: box.port,
    secure: box.secure,
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

    if (await findMessage(client, inbox, subject, box.sender, sinceMs)) {
      return { status: 'inbox', folder: inbox, checkedAt: new Date().toISOString() };
    }

    if (junk && await findMessage(client, junk, subject, box.sender, sinceMs)) {
      return { status: 'spam', folder: junk, checkedAt: new Date().toISOString() };
    }

    return { status: 'waiting', checkedAt: new Date().toISOString() };
  } catch (err) {
    return { status: 'error', error: err.message, checkedAt: new Date().toISOString() };
  } finally {
    try { await client.logout(); } catch {}
  }
}
