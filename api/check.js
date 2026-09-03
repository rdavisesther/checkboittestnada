import { checkMailbox } from '../lib/imap.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const { mailboxes, subject, minutes, from } = req.body || {};

  const fromFilter = (from || '').trim();
  const subjectFilter = (subject || '').trim();

  if (!subjectFilter && !fromFilter) {
    return res.status(400).json({ error: 'Provide a subject or a from address.' });
  }

  if (!Array.isArray(mailboxes) || mailboxes.length === 0) {
    return res.status(400).json({ error: 'At least one mailbox is required.' });
  }

  const minutesCount = Math.max(1, Number(minutes) || 1440);
  const sinceMs = Date.now() - minutesCount * 60 * 1000;

  const results = await Promise.all(
    mailboxes.map(async (box) => {
      const result = await checkMailbox(box, subjectFilter, sinceMs, fromFilter);
      return { email: box.email || 'unknown', ...result };
    })
  );

  res.json({
    subject: subjectFilter || '',
    from: fromFilter || '',
    minutes: minutesCount,
    since: new Date(sinceMs).toISOString(),
    checkedAt: new Date().toISOString(),
    results
  });
}
