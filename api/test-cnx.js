import { testConnection } from '../lib/imap.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const { host, port, secure, user, pass } = req.body || {};

  if (!host || !user || !pass) {
    return res.status(400).json({ ok: false, error: 'Host, username and password are required.' });
  }

  const result = await testConnection({
    host: String(host),
    port: Number(port || 993),
    secure: secure !== false,
    user: String(user),
    pass: String(pass)
  });

  res.json({ ...result, checkedAt: new Date().toISOString() });
}
