import { getBoxes } from '../lib/config.js';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const boxes = getBoxes();
  res.json(boxes.map(b => ({
    id: b.id,
    email: b.email,
    configured: Boolean(b.host && b.user && b.pass)
  })));
}
