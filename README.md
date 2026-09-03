# Inbox Tester v1

## 1. Install
```bash
npm install
```

## 2. Configure
Copy `.env.example` to `.env` and fill in:

- SMTP credentials for the account that sends the test.
- IMAP credentials for the two test mailboxes.

Do NOT put these credentials in `public/` or the browser.

For Gmail, prefer Google OAuth or a Google App Password for IMAP instead of your normal Google password.

## 3. Run
```bash
npm start
```

Open:
http://localhost:3000

## What v1 does

- Shows the two configured test mailboxes.
- Sends the exact subject + HTML to both.
- Adds a unique `X-Inbox-Test-ID` header.
- Polls each mailbox over IMAP.
- Reports Inbox / Spam-Junk / Not received / Error.

## Limitation

Generic IMAP does not reliably expose Gmail's Promotions category as a normal folder.
For exact Gmail category detection (Primary / Promotions / Social / Spam), add Gmail API label access in v2.


## Matching rule

The tracker searches each mailbox for:
1. The exact campaign Subject.
2. A message received around the send time (5-minute tracking window).
3. Optionally, the expected sender address if `BOX1_EXPECTED_SENDER` / `BOX2_EXPECTED_SENDER` are set.

The app does not send your campaign; your existing campaign platform remains the sender.
