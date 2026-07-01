jest.mock('../db', () => ({
  query: jest.fn(),
}));

jest.mock('../services/socket', () => ({
  emitToAll: jest.fn(),
}));

jest.mock('../services/notifier', () => ({
  triggerNotifications: jest.fn().mockResolvedValue(undefined),
}));

import axios from 'axios';
import { performSingleCheck } from '../services/monitor';
import { query } from '../db';
import { emitToAll } from '../services/socket';
import { triggerNotifications } from '../services/notifier';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Monitoring Service - performSingleCheck', () => {
  const mockWebsite = {
    id: 'web-123',
    name: 'Test Endpoint',
    url: 'https://test.uptime.local',
    timeout: 5,
    user_id: 'user-789',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should process a successful check and insert result', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      status: 200,
    } as any);

    // Mock DB insert query to return checking result
    (query as jest.Mock).mockResolvedValueOnce({
      rows: [{
        id: 'result-456',
        website_id: mockWebsite.id,
        status_code: 200,
        response_time: 50,
        is_up: true,
        error_message: null,
        checked_at: new Date(),
        ssl_days_remaining: 30,
      }],
    });

    // Mock DB select query for previous status
    (query as jest.Mock).mockResolvedValueOnce({
      rows: [],
    });

    const result = await performSingleCheck(mockWebsite);

    expect(result.is_up).toBe(true);
    expect(result.status_code).toBe(200);
    expect(mockedAxios.get).toHaveBeenCalledWith(mockWebsite.url, expect.any(Object));
    expect(query).toHaveBeenCalled();
    expect(emitToAll).toHaveBeenCalledWith('check-completed', expect.any(Object));
  });

  it('should detect state change from UP to DOWN and trigger notifications', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('Network Error'));

    // DB insert mock
    (query as jest.Mock).mockResolvedValueOnce({
      rows: [{
        id: 'result-789',
        website_id: mockWebsite.id,
        status_code: null,
        response_time: 120,
        is_up: false,
        error_message: 'Network Error',
        checked_at: new Date(),
        ssl_days_remaining: null,
      }],
    });

    // Mock previous check: site was UP
    (query as jest.Mock).mockResolvedValueOnce({
      rows: [{ is_up: true }],
    });

    // Mock alert insert
    (query as jest.Mock).mockResolvedValueOnce({
      rows: [{ id: 'alert-abc' }],
    });

    const result = await performSingleCheck(mockWebsite);

    expect(result.is_up).toBe(false);
    expect(triggerNotifications).toHaveBeenCalledWith(mockWebsite, 'down', expect.any(String));
    expect(emitToAll).toHaveBeenCalledWith('website-status-changed', expect.any(Object));
  });
});
