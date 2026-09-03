import 'dotenv/config';

export function getBoxes() {
  return [
    {
      id: 'box1',
      email: process.env.BOX1_EMAIL || 'michpres12@gmail.com',
      host: process.env.BOX1_IMAP_HOST,
      port: Number(process.env.BOX1_IMAP_PORT || 993),
      secure: String(process.env.BOX1_IMAP_SECURE || 'true') === 'true',
      user: process.env.BOX1_IMAP_USER,
      pass: process.env.BOX1_IMAP_PASS,
      sender: process.env.BOX1_EXPECTED_SENDER || ''
    },
    {
      id: 'box2',
      email: process.env.BOX2_EMAIL || 'haryjack986@gmail.com',
      host: process.env.BOX2_IMAP_HOST,
      port: Number(process.env.BOX2_IMAP_PORT || 993),
      secure: String(process.env.BOX2_IMAP_SECURE || 'true') === 'true',
      user: process.env.BOX2_IMAP_USER,
      pass: process.env.BOX2_IMAP_PASS,
      sender: process.env.BOX2_EXPECTED_SENDER || ''
    }
  ];
}

export function getSmtp() {
  return {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  };
}

export function getFromAddress() {
  return {
    name: process.env.FROM_NAME || 'Inbox Tester',
    email: process.env.FROM_EMAIL || process.env.SMTP_USER
  };
}

export function boxConfigured(box) {
  return Boolean(box.host && box.user && box.pass);
}
