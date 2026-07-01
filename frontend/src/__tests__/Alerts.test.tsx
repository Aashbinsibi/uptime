import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import Alerts from '../components/Alerts';
import api from '../utils/api';

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

// Mock API client
vi.mock('../utils/api', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
  },
}));

describe('Alerts Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render loading status initially', async () => {
    (api.get as any).mockReturnValue(new Promise(() => {}));
    
    const { container } = render(<Alerts />);
    
    expect(container.getElementsByClassName('shimmer').length).toBe(3);
  });

  it('should render operational message when no alerts are present', async () => {
    (api.get as any).mockResolvedValueOnce({
      data: {
        success: true,
        data: [],
      },
    });

    render(<Alerts />);

    await waitFor(() => {
      expect(screen.getByText(/All Channels Operational/i)).toBeInTheDocument();
      expect(screen.getByText(/No recent alert incidents matched your active filters/i)).toBeInTheDocument();
    });
  });

  it('should render alert list when alerts are fetched', async () => {
    const mockAlerts = [
      {
        id: 'alert-1',
        website_id: 'web-1',
        website_name: 'Database Node',
        website_url: 'https://db.local',
        type: 'down',
        status: 'active',
        message: 'Database connection failed',
        triggered_at: new Date().toISOString(),
        resolved_at: null,
      },
    ];

    (api.get as any).mockResolvedValueOnce({
      data: {
        success: true,
        data: mockAlerts,
      },
    });

    render(<Alerts />);

    await waitFor(() => {
      expect(screen.getByText('Database Node')).toBeInTheDocument();
      expect(screen.getByText('Database connection failed')).toBeInTheDocument();
      expect(screen.getByText('Acknowledge')).toBeInTheDocument();
      expect(screen.getByText('Resolve')).toBeInTheDocument();
    });
  });
});
