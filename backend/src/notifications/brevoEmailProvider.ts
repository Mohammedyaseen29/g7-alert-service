import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { logger } from '../config/logger.js';
import type { AlarmEvent } from '../alarms/alarmEngine.js';
import type { NotificationProvider } from './notificationProvider.js';
import { alarmHtml, alarmSubject, recoveryHtml, recoverySubject } from './emailTemplates.js';

export interface SmtpOpts {
  enabled: boolean;
  host: string;
  port: number;
  user: string;
  pass: string;
  fromEmail: string;
  fromName: string;
}

// Alarm engine depends on NotificationProvider, never on nodemailer directly.
export class BrevoEmailProvider implements NotificationProvider {
  readonly status: string;
  private tx: Transporter | null = null;

  constructor(private opts: SmtpOpts, private recipients: () => string[]) {
    this.status = opts.enabled ? 'enabled' : 'disabled (EMAIL_ENABLED=false, logging only)';
    if (opts.enabled) {
      this.tx = nodemailer.createTransport({
        host: opts.host,
        port: opts.port,
        secure: opts.port === 465,
        auth: opts.user ? { user: opts.user, pass: opts.pass } : undefined,
      });
    }
  }

  async sendAlarm(alert: AlarmEvent, context: { sensorName?: string; battery?: number }): Promise<boolean> {
    if (!this.opts.enabled || !this.tx) {
      logger.warn({ sensor: alert.sensorId, kind: alert.kind, value: alert.value, threshold: alert.threshold }, `[ALERT] ${alert.message} (email disabled)`);
      return false;
    }
    const to = this.recipients();
    if (to.length === 0) {
      logger.warn('Email is enabled but no notification recipients are configured; skipping');
      return false;
    }
    const result = await this.tx.sendMail({
      from: `"${this.opts.fromName}" <${this.opts.fromEmail}>`,
      to,
      subject: alarmSubject(alert),
      html: alarmHtml(alert, { ...context, stationId: alert.stationId }),
    });
    if ((result.rejected?.length ?? 0) > 0 || (result.accepted?.length ?? 0) !== to.length) throw new Error('SMTP did not accept every alarm recipient');
    logger.info({ sensor: alert.sensorId, kind: alert.kind }, 'alarm email sent');
    return true;
  }

  async sendRecovery(alert: AlarmEvent, context: { sensorName?: string }): Promise<boolean> {
    if (!this.opts.enabled || !this.tx) {
      logger.info({ sensor: alert.sensorId, kind: alert.kind }, `[RECOVERY] ${alert.message} (email disabled)`);
      return false;
    }
    const to = this.recipients();
    if (to.length === 0) return false;
    const result = await this.tx.sendMail({
      from: `"${this.opts.fromName}" <${this.opts.fromEmail}>`,
      to,
      subject: recoverySubject(alert),
      html: recoveryHtml(alert, { ...context, stationId: alert.stationId }),
    });
    if ((result.rejected?.length ?? 0) > 0 || (result.accepted?.length ?? 0) !== to.length) throw new Error('SMTP did not accept every recovery recipient');
    logger.info({ sensor: alert.sensorId, kind: alert.kind }, 'recovery email sent');
    return true;
  }
}
