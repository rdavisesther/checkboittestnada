import nodemailer from 'nodemailer';
import { getBoxes, getSmtp, getFromAddress, boxConfigured } from '../../lib/config.js';
import { checkMailbox } from '../../lib/imap.js';

const TIMEOUT_MS = Number(process.env.TIMEOUT_SECONDS || 300) * 1000;

function encodeTestId(subject, sentAt, boxEmails) {
  const data = JSON.stringify({ subject, sentAt, boxEmails });
  return Buffer.from(data).toString('base64url');
}

function decodeTestId(id) {
  try {
    return JSON.parse(Buffer.from(id, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

async function sendTest(req, res) {
  const { subject, html } = req.body || {};

  if (!subject?.trim()) {
    return res.status(400).json({ error: 'Subject is required.' });
  }
  if (!html?.trim()) {
    return res.status(400).json({ error: 'HTML is required.' });
  }

  const boxes = getBoxes();
  const smtpConfig = getSmtp();
  const from = getFromAddress();

  const smtp = nodemailer.createTransport(smtpConfig);
  const sentAt = Date.now();
  const boxEmails = [];

  const results = [];

  for (const box of boxes) {
    if (!box.email || !boxConfigured(box)) {
      results.push({ mailbox: box.email, status: 'not_configured' });
      continue;
    }

    try {
      await smtp.sendMail({
        from: `${from.name} <${from.email}>`,
        to: box.email,
        subject: subject.trim(),
        html,
        headers: {
          'X-Inbox-Tester': 'v1'
        }
      });
      results.push({ mailbox: box.email, status: 'sent', sentAt: new Date(sentAt).toISOString() });
      boxEmails.push(box.email);
    } catch (err) {
      results.push({ mailbox: box.email, status: 'send_error', error: err.message });
    }
  }

  const id = encodeTestId(subject.trim(), sentAt, boxEmails);

  res.json({
    id,
    subject: subject.trim(),
    createdAt: new Date(sentAt).toISOString(),
    results
  });
}

async function checkTest(req, res) {
  const { id } = req.query || {};

  if (!id) {
    return res.status(400).json({ error: 'Test ID is required.' });
  }

  const decoded = decodeTestId(id);
  if (!decoded) {
    return res.status(400).json({ error: 'Invalid test ID.' });
  }

  const { subject, sentAt, boxEmails } = decoded;
  const boxes = getBoxes();
  const elapsed = Date.now() - sentAt;

  if (elapsed > TIMEOUT_MS) {
    const results = boxes.map(b => ({
      mailbox: b.email,
      status: boxEmails.includes(b.email) ? 'not_received' : 'not_configured'
    }));
    return res.json({ id, subject, createdAt: new Date(sentAt).toISOString(), results });
  }

  const results = [];

  for (const box of boxes) {
    if (!box.email || !boxConfigured(box)) {
      results.push({ mailbox: box.email, status: 'not_configured' });
      continue;
    }

    const result = await checkMailbox(box, subject, sentAt);
    results.push({ mailbox: box.email, ...result });
  }

  res.json({
    id,
    subject,
    createdAt: new Date(sentAt).toISOString(),
    results
  });
}

export default async function handler(req, res) {
  if (req.method === 'POST') {
    return sendTest(req, res);
  }
  if (req.method === 'GET') {
    return checkTest(req, res);
  }
  res.status(405).json({ error: 'Method not allowed.' });
}
