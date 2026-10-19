import nodemailer from 'nodemailer';
import type { Logger } from '../context.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/**
 * SMTP mailer. With no SMTP_URL (development/test only — config rejects that in production)
 * messages are written to the log so magic links can be followed locally.
 */
export function createMailer(smtpUrl: string, from: string, log: Logger): Mailer {
  if (!smtpUrl) {
    return {
      async send(message) {
        log.info({ to: message.to, subject: message.subject, text: message.text }, 'mail (log transport)');
      },
    };
  }
  const transport = nodemailer.createTransport(smtpUrl);
  return {
    async send(message) {
      await transport.sendMail({ from, ...message });
    },
  };
}

export function magicLinkEmail(link: string): Omit<MailMessage, 'to'> {
  return {
    subject: 'Your sign-in link',
    text: `Use this link to sign in. It expires in 15 minutes and works once.\n\n${link}\n\nIf you didn't ask for it, ignore this email.`,
    html: `<p style="font-family:Georgia,serif;font-size:18px">Your sign-in link</p>
<p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6">It expires in 15 minutes and works once.</p>
<p><a href="${link}" style="font-family:Arial,sans-serif;font-size:15px;color:#C86D51">Sign in</a></p>
<p style="font-family:Arial,sans-serif;font-size:13px;color:#666">If you didn't ask for it, ignore this email.</p>`,
  };
}
