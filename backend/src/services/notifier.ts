import nodemailer from 'nodemailer';
import axios from 'axios';
import { query } from '../db';
import { notificationQueue, registerQueueProcessor } from './queue';
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
export const triggerNotifications = async (website: any, eventType: 'down' | 'resolved' | 'ssl_expiring', message: string) => {
  try {
    const userId = website.user_id;

    // Fetch active alert channels
    const { rows: channels } = await query(
      'SELECT id, type, config FROM alert_channels WHERE user_id = $1 AND enabled = TRUE',
      [userId]
    );

    const emailEnabled = channels.some(c => c.type === 'email');
    const slackChannel = channels.find(c => c.type === 'slack');
    const teamsChannel = channels.find(c => c.type === 'teams');

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

    // Queue Teams job
    if (teamsChannel) {
      const webhookUrl = teamsChannel.config.webhookUrl;
      if (webhookUrl) {
        await notificationQueue.add('teams', {
          webhookUrl,
          website,
          eventType,
          message
        });
        if (process.env.NODE_ENV === 'development') {
          logger.info(`[Notifier] Enqueued Teams webhook alert job for ${website.name}`);
        }
      }
    }


  } catch (error: any) {
    logger.error('[Notifier] Error enqueuing alert notifications:', { error: error.message });
  }
};

// 2. Job Handlers (consumed by the Bull worker)
export const sendEmailAlert = async (website: any, eventType: 'down' | 'resolved' | 'ssl_expiring', message: string) => {
  const isDown = eventType === 'down';
  const isSsl = eventType === 'ssl_expiring';
  
  let statusText = 'UP 🟢';
  let badgeColor = '#d4edda';
  let borderStyle = '#c3e6cb';
  let textColor = '#155724';

  if (isDown) {
    statusText = 'DOWN 🔴';
    badgeColor = '#f8d7da';
    borderStyle = '#f5c6cb';
    textColor = '#721c24';
  } else if (isSsl) {
    statusText = 'SSL EXPIRING 🟡';
    badgeColor = '#fff3cd';
    borderStyle = '#ffeeba';
    textColor = '#856404';
  }

  const subject = `[${eventType.toUpperCase()}] ${website.name}`;
  
  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px; border-radius: 8px; border: 1px solid ${borderStyle}; background-color: ${badgeColor};">
      <h2 style="color: ${textColor}; margin-top: 0;">Website Security Notification</h2>
      <p style="font-size: 16px;">
        <strong>Website:</strong> <a href="${website.url}" style="color: #004085; text-decoration: none;">${website.name}</a><br>
        <strong>URL:</strong> ${website.url}<br>
        <strong>Status:</strong> <span style="font-weight: bold; color: ${textColor};">${statusText}</span><br>
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
  logger.info(`[Email Worker] Dispatched alert email for ${website.name} (type: ${eventType})`);
};

export const sendSlackAlert = async (webhookUrl: string, website: any, eventType: 'down' | 'resolved' | 'ssl_expiring', message: string) => {
  const isDown = eventType === 'down';
  const isSsl = eventType === 'ssl_expiring';

  let color = '#3cb371';
  let statusEmoji = '🟢 *UP*';
  let titleText = 'Uptime Monitoring Status Change';

  if (isDown) {
    color = '#e15b64';
    statusEmoji = '🔴 *DOWN*';
  } else if (isSsl) {
    color = '#ffb300';
    statusEmoji = '🟡 *SSL EXPIRING*';
    titleText = 'SSL Certificate Expiration Warning';
  }

  const slackPayload = {
    attachments: [
      {
        fallback: `Website status update: ${website.name} is ${eventType.toUpperCase()}`,
        color: color,
        pretext: `⚠️ *${titleText}*`,
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
            value: isDown ? 'OFFLINE' : isSsl ? 'SSL WARNING' : 'ONLINE',
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

  logger.info(`[Slack Worker] Dispatched webhook message for ${website.name} (type: ${eventType})`);
};

export const sendTeamsAlert = async (webhookUrl: string, website: any, eventType: 'down' | 'resolved' | 'ssl_expiring', message: string) => {
  const isDown = eventType === 'down';
  const isSsl = eventType === 'ssl_expiring';

  let themeColor = '2E7D32'; // Green
  let statusEmoji = '🟢 UP';
  let titleText = 'Uptime Monitoring Status Change';

  if (isDown) {
    themeColor = 'D32F2F'; // Red
    statusEmoji = '🔴 DOWN';
  } else if (isSsl) {
    themeColor = 'FBC02D'; // Amber
    statusEmoji = '🟡 SSL EXPIRING';
    titleText = 'SSL Certificate Expiration Warning';
  }

  const textContent = `The status of your monitored site has changed to **${statusEmoji}**.\n\n**Website:** [${website.name}](${website.url})\n**URL:** ${website.url}\n**Check Time:** ${new Date().toLocaleString()}\n**Details:** ${message}`;

  const teamsPayload = {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    "themeColor": themeColor,
    "summary": `Website status update: ${website.name} is ${eventType.toUpperCase()}`,
    "title": `⚠️ ${titleText}`,
    "text": textContent, // Critical for modern Teams Workflows that pull messages from a top-level text property
    "sections": [
      {
        "activityTitle": `**${website.name}** (${website.url})`,
        "activitySubtitle": `The status of your monitored site has changed to **${statusEmoji}**.`,
        "facts": [
          {
            "name": "Check Time",
            "value": new Date().toLocaleString()
          },
          {
            "name": "Status",
            "value": isDown ? "OFFLINE" : isSsl ? "SSL WARNING" : "ONLINE"
          },
          {
            "name": "Details",
            "value": message
          }
        ],
        "markdown": true
      }
    ],
    "potentialAction": [
      {
        "@type": "OpenUri",
        "name": "Visit Website",
        "targets": [
          {
            "os": "default",
            "uri": website.url
          }
        ]
      }
    ]
  };

  try {
    await axios.post(webhookUrl, teamsPayload, {
      headers: { 'Content-Type': 'application/json' }
    });
    logger.info(`[Teams Worker] Dispatched webhook message for ${website.name} (type: ${eventType})`);
  } catch (error: any) {
    logger.error(`[Teams Worker] Failed to dispatch webhook message for ${website.name}:`, {
      message: error.message,
      response: error.response?.data
    });
    throw error; // Re-throw to trigger Bull queue retry mechanism
  }
};

// 3. Register the consumer processing logic
export const initNotificationWorker = () => {
  registerQueueProcessor('email', async (job) => {
    const { website, eventType, message } = job.data;
    await sendEmailAlert(website, eventType, message);
  });

  registerQueueProcessor('slack', async (job) => {
    const { webhookUrl, website, eventType, message } = job.data;
    await sendSlackAlert(webhookUrl, website, eventType, message);
  });

  registerQueueProcessor('teams', async (job) => {
    const { webhookUrl, website, eventType, message } = job.data;
    await sendTeamsAlert(webhookUrl, website, eventType, message);
  });
};
