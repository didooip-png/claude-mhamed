import type { AddressInfo } from 'node:net';
import { simpleParser, type ParsedMail } from 'mailparser';
import { SMTPServer } from 'smtp-server';

/** Serveur SMTP de test en mémoire (équivalent de Mailpit), arrêtable pour simuler une panne. */
export class FakeSmtp {
  messages: ParsedMail[] = [];
  port = 0;
  private server: SMTPServer | null = null;

  async start(port = this.port): Promise<void> {
    this.server = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      logger: false,
      onData: (stream, _session, callback) => {
        simpleParser(stream)
          .then((mail) => {
            this.messages.push(mail);
            callback();
          })
          .catch((err: Error) => callback(err));
      },
    });
    await new Promise<void>((resolve) => this.server!.listen(port, '127.0.0.1', resolve));
    this.port = (
      this.server as unknown as { server: { address(): AddressInfo } }
    ).server.address().port;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }
}
