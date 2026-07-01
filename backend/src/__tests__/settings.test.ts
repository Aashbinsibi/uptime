jest.mock('../db', () => ({
  query: jest.fn(),
}));

jest.mock('../services/queue', () => ({
  notificationQueue: {
    add: jest.fn(),
    on: jest.fn(),
  },
  registerQueueProcessor: jest.fn(),
}));

jest.mock('../services/notifier', () => ({
  sendSlackAlert: jest.fn(),
  sendTeamsAlert: jest.fn(),
  sendEmailAlert: jest.fn(),
}));

import { isRestrictedIP, isValidWebhookUrl } from '../routes/settings';


describe('isRestrictedIP', () => {
  it('should return true for IPv4 loopback (127.0.0.1)', () => {
    expect(isRestrictedIP('127.0.0.1')).toBe(true);
    expect(isRestrictedIP('127.255.0.1')).toBe(true);
  });

  it('should return true for IPv4 private networks', () => {
    // Class A
    expect(isRestrictedIP('10.0.0.1')).toBe(true);
    expect(isRestrictedIP('10.255.255.255')).toBe(true);
    // Class B
    expect(isRestrictedIP('172.16.0.1')).toBe(true);
    expect(isRestrictedIP('172.31.255.254')).toBe(true);
    // Class C
    expect(isRestrictedIP('192.168.1.1')).toBe(true);
    expect(isRestrictedIP('192.168.254.254')).toBe(true);
  });

  it('should return true for IPv4 link-local (169.254.x.x)', () => {
    expect(isRestrictedIP('169.254.0.1')).toBe(true);
  });

  it('should return true for current network (0.x.x.x)', () => {
    expect(isRestrictedIP('0.0.0.0')).toBe(true);
  });

  it('should return false for public IPv4 addresses', () => {
    expect(isRestrictedIP('8.8.8.8')).toBe(false);
    expect(isRestrictedIP('1.1.1.1')).toBe(false);
    expect(isRestrictedIP('142.250.190.46')).toBe(false);
  });

  it('should return true for IPv6 loopback and restricted ranges', () => {
    expect(isRestrictedIP('::1')).toBe(true);
    expect(isRestrictedIP('fe80::1')).toBe(true);
    expect(isRestrictedIP('fc00::1')).toBe(true);
  });

  it('should return false for public IPv6 addresses', () => {
    expect(isRestrictedIP('2001:4860:4860::8888')).toBe(false);
  });
});

describe('isValidWebhookUrl', () => {
  it('should reject non-HTTPS URLs', async () => {
    const res = await isValidWebhookUrl('http://hooks.slack.com/services/test', 'slack');
    expect(res.valid).toBe(false);
    expect(res.error).toContain('HTTPS');
  });

  it('should reject invalid domains for Slack', async () => {
    const res = await isValidWebhookUrl('https://malicious-domain.com/services/test', 'slack');
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Slack webhook must be from hooks.slack.com');
  });

  it('should reject invalid domains for Teams', async () => {
    const res = await isValidWebhookUrl('https://malicious-domain.com/webhook', 'teams');
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Teams webhook must be from a valid Microsoft Teams or Power Automate domain');
  });

  it('should validate correct Slack webhook domains', async () => {
    const res = await isValidWebhookUrl('https://hooks.slack.com/services/not-a-valid-token-no-secrets-here', 'slack');
    if (res.valid === false) {
      expect(res.error).toContain('Unable to resolve');
    } else {
      expect(res.valid).toBe(true);
    }
  });

  it('should reject loopback/private webhook targets', async () => {
    const res = await isValidWebhookUrl('https://127.0.0.1/webhook', 'slack');
    expect(res.valid).toBe(false);
  });
});
