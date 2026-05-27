import nodemailer from 'nodemailer';
import axios from 'axios';
import { query } from '../db';
import { notificationQueue, startQueueWorker } from './queue';
import logger from './logger';

// SMTP Transporter configuration
const getEmailTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER || 'user@example.com',
      pass: process.env.SMTP_PASSWORD || 'app_password',
    },
  });
};

// 1. Refactored Trigger: Enqueues jobs instead of executing HTTP/SMTP calls synchronously
export const triggerNotifications = async (website: any, eventType: 'down' | 'resolved', message: string) => {
  try {
    const userId = website.user_id;

    // Fetch active alert channels
    const { rows: channels } = await query(
      'SELECT id, type, config FROM alert_channels WHERE user_id = $1 AND enabled = TRUE',
      [userId]
    );

    const emailEnabled = channels.some(c => c.type === 'email');
    const slackChannel = channels.find(c => c.type === 'slack');

    // Queue email job
    if (emailEnabled) {
      await notificationQueue.add('email', {
        website,
        eventType,
        message
      });
      if (process.env.NODE_ENV === 'development') {
        logger.info(`[Notifier] Enqueued email alert job for ${website.name}`);
      }
    }

    // Queue Slack job
    if (slackChannel) {
      const webhookUrl = slackChannel.config.webhookUrl;
      if (webhookUrl) {
        await notificationQueue.add('slack', {
          webhookUrl,
          website,
          eventType,
          message
        });
        if (process.env.NODE_ENV === 'development') {
          logger.info(`[Notifier] Enqueued Slack webhook alert job for ${website.name}`);
        }
      }
    }
  } catch (error: any) {
    logger.error('[Notifier] Error enqueuing alert notifications:', { error: error.message });
  }
};

// 2. Job Handlers (consumed by the Bull worker)
export const sendEmailAlert = async (website: any, eventType: 'down' | 'resolved', message: string) => {
  const isDown = eventType === 'down';
  const subject = `[${isDown ? 'ALERT' : 'RESOLVED'}] ${website.name} is ${isDown ? 'DOWN' : 'UP'}`;
  
  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px; border-radius: 8px; border: 1px solid ${isDown ? '#f5c6cb' : '#c3e6cb'}; background-color: ${isDown ? '#f8d7da' : '#d4edda'};">
      <h2 style="color: ${isDown ? '#721c24' : '#155724'}; margin-top: 0;">Website Status Update</h2>
      <p style="font-size: 16px;">
        <strong>Website:</strong> <a href="${website.url}" style="color: #004085; text-decoration: none;">${website.name}</a><br>
        <strong>URL:</strong> ${website.url}<br>
        <strong>Status:</strong> <span style="font-weight: bold; color: ${isDown ? '#dc3545' : '#28a745'};">${isDown ? 'DOWN 🔴' : 'UP 🟢'}</span><br>
        <strong>Time:</strong> ${new Date().toLocaleString()}<br>
        <strong>Detail:</strong> ${message}
      </p>
      <hr style="border: 0; border-top: 1px solid #ced4da; margin: 20px 0;">
      <p style="font-size: 12px; color: #6c757d;">Automated alert from Uptime Monitor.</p>
    </div>
  `;

  const transporter = getEmailTransporter();
  const mailOptions = {
    from: `"Uptime Monitor" <${process.env.SMTP_USER}>`,
    to: process.env.SMTP_USER,
    subject: subject,
    html: html,
  };

  await transporter.sendMail(mailOptions);
  logger.info(`[Email Worker] Dispatched incident alert email for ${website.name}`);
};

export const sendSlackAlert = async (webhookUrl: string, website: any, eventType: 'down' | 'resolved', message: string) => {
  const isDown = eventType === 'down';
  const color = isDown ? '#e15b64' : '#3cb371';
  const statusEmoji = isDown ? '🔴 *DOWN*' : '🟢 *UP*';

  const slackPayload = {
    attachments: [
      {
        fallback: `Website status update: ${website.name} is ${isDown ? 'DOWN' : 'UP'}`,
        color: color,
        pretext: `⚠️ *Uptime Monitoring Status Change*`,
        title: `${website.name} (${website.url})`,
        title_link: website.url,
        text: `The status of your monitored site has changed to ${statusEmoji}.\n\n*Details:* _${message}_`,
        fields: [
          {
            title: 'Check Time',
            value: new Date().toLocaleString(),
            short: true
          },
          {
            title: 'Status',
            value: isDown ? 'OFFLINE' : 'ONLINE',
            short: true
          }
        ],
        footer: 'Self-Hosted Uptime Monitoring System',
        ts: Math.floor(Date.now() / 1000)
      }
    ]
  };

  await axios.post(webhookUrl, slackPayload, {
    headers: { 'Content-Type': 'application/json' }
  });

  logger.info(`[Slack Worker] Dispatched webhook incident message for ${website.name}`);
};

// 3. Register the consumer processing logic
export const initNotificationWorker = () => {
  startQueueWorker(async (job) => {
    const { name, data } = job;
    if (name === 'email') {
      await sendEmailAlert(data.website, data.eventType, data.message);
    } else if (name === 'slack') {
      await sendSlackAlert(data.webhookUrl, data.website, data.eventType, data.message);
    } else {
      logger.warn(`[Bull Worker] Unknown job type received: ${name}`);
    }
  });
};
