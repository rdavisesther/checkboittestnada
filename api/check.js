import { checkMailbox } from '../lib/imap.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const { mailboxes, subject, since } = req.body || {};

  if (!subject?.trim()) {
    return res.status(400).json({ error: 'Subject is required.' });
  }

  if (!Array.isArray(mailboxes) || mailboxes.length === 0) {
    return res.status(400).json({ error: 'At least one mailbox is required.' });
  }

  const sinceMs = since ? new Date(since).getTime() : Date.now() - 5 * 60 * 1000;

  const results = await Promise.all(
    mailboxes.map(async (box) => {
      const result = await checkMailbox(box, subject.trim(), sinceMs);
      return { email: box.email || 'unknown', ...result };
    })
  );

  res.json({
    subject: subject.trim(),
    checkedAt: new Date().toISOString(),
    results
  });
}
