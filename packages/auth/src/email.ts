import { getEnv, logger } from '@bond-os/shared/server';
import type { Transporter } from 'nodemailer';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailProvider {
  send(input: SendEmailInput): Promise<void>;
}

/** Default dev provider: logs the email instead of sending it. */
class ConsoleEmailProvider implements EmailProvider {
  private log = logger.child('email');

  async send(input: SendEmailInput): Promise<void> {
    this.log.info(`Email to ${input.to}: ${input.subject}`, { text: input.text });
  }
}

/** SMTP provider, activated automatically once SMTP_HOST is configured. */
class SmtpEmailProvider implements EmailProvider {
  private log = logger.child('email');
  private transportPromise: Promise<Transporter>;

  constructor() {
    const env = getEnv();
    this.transportPromise = import('nodemailer').then(({ default: nodemailer }) =>
      nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT ?? 587,
        secure: (env.SMTP_PORT ?? 587) === 465,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      }),
    );
  }

  async send(input: SendEmailInput): Promise<void> {
    const transport = await this.transportPromise;
    await transport.sendMail({
      from: getEnv().EMAIL_FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    this.log.info(`Sent email to ${input.to}: ${input.subject}`);
  }
}

let instance: EmailProvider | undefined;

/**
 * Returns the active email provider. Falls back to logging emails to the
 * console when SMTP isn't configured, so password-reset flows work in local
 * dev without any external service.
 */
export function getEmailProvider(): EmailProvider {
  if (!instance) {
    instance = getEnv().SMTP_HOST ? new SmtpEmailProvider() : new ConsoleEmailProvider();
  }
  return instance;
}

export function renderResetPasswordEmail(resetUrl: string): Pick<SendEmailInput, 'html' | 'text'> {
  return {
    text: `Reset your BOND OS password by visiting: ${resetUrl}\n\nIf you didn't request this, you can ignore this email.`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Reset your password</h2>
        <p>Click the button below to choose a new password. This link expires in 1 hour.</p>
        <p style="margin: 24px 0;">
          <a href="${resetUrl}" style="background:#111827;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;">
            Reset password
          </a>
        </p>
        <p style="color:#6b7280;font-size:14px;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  };
}
