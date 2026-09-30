/**
 * Boîte de capture d'e-mails pour les tests (rôle de Mailpit) :
 *  - SMTP sur SMTP_PORT (sans authentification ni chiffrement) ;
 *  - HTTP sur HTTP_PORT : GET /messages, DELETE /messages, POST /smtp/down, POST /smtp/up
 *    (« down » ferme le port SMTP : simule une panne du serveur de messagerie).
 */
import { createServer } from 'node:http';
import { simpleParser } from 'mailparser';
import { SMTPServer } from 'smtp-server';

const SMTP_PORT = Number(process.env.SMTP_PORT ?? 2525);
const HTTP_PORT = Number(process.env.HTTP_PORT ?? 8026);
let messages = [];
let smtp = null;

function startSmtp() {
  return new Promise((resolve, reject) => {
    const server = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      onData(stream, session, callback) {
        const chunks = [];
        stream.on('data', (c) => chunks.push(c));
        stream.on('end', async () => {
          try {
            const mail = await simpleParser(Buffer.concat(chunks));
            messages.push({
              receivedAt: new Date().toISOString(),
              from: mail.from?.value?.[0]?.address ?? null,
              to: (mail.to?.value ?? []).map((a) => a.address),
              bcc: session.envelope.rcptTo.map((r) => r.address),
              subject: mail.subject ?? '',
              text: mail.text ?? '',
              attachments: mail.attachments.map((a) => ({
                filename: a.filename,
                contentType: a.contentType,
                size: a.size,
                pdf: a.content.subarray(0, 5).toString() === '%PDF-',
              })),
            });
            callback();
          } catch (err) {
            callback(err);
          }
        });
      },
    });
    server.on('error', reject);
    server.listen(SMTP_PORT, '127.0.0.1', () => {
      smtp = server;
      resolve();
    });
  });
}

function stopSmtp() {
  return new Promise((resolve) => {
    if (!smtp) return resolve();
    const s = smtp;
    smtp = null;
    s.close(() => resolve());
  });
}

await startSmtp();

createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, smtp: !!smtp });
  if (req.method === 'GET' && req.url === '/messages') return send(200, messages);
  if (req.method === 'DELETE' && req.url === '/messages') {
    messages = [];
    return send(200, { ok: true });
  }
  if (req.method === 'POST' && req.url === '/smtp/down') {
    await stopSmtp();
    return send(200, { smtp: false });
  }
  if (req.method === 'POST' && req.url === '/smtp/up') {
    if (!smtp) await startSmtp();
    return send(200, { smtp: true });
  }
  send(404, { error: 'not found' });
}).listen(HTTP_PORT, '127.0.0.1', () =>
  console.log(`Boîte de capture : SMTP ${SMTP_PORT}, HTTP ${HTTP_PORT}`),
);
