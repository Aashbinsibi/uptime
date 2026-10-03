jest.mock('../db', () => ({
  query: jest.fn(),
}));

jest.mock('../services/socket', () => ({
  getIO: jest.fn(() => ({
    emit: jest.fn()
  })),
  emitToAll: jest.fn(),
}));

import request from 'supertest';
import express from 'express';
import agentRouter from '../routes/agent';
import serversRouter from '../routes/servers';
import { query } from '../db';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_please_change_in_production';

const makeCookie = (payload: any) => {
  const token = jwt.sign(payload, JWT_SECRET);
  return `token=${token}`;
};

describe('End-to-End API Integration Tests', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/agent', agentRouter);
    app.use('/api/servers', serversRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Agent & Fleet Integration Suite', () => {
    it('GET /api/agent/version should return current agent version v0.1 and metadata', async () => {
      const res = await request(app).get('/api/agent/version');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.current_version).toBe('0.1');
      expect(res.body.release_notes).toContain('Gravity Agent');
    });

    it('GET /api/agent/install.sh should serve valid bash installation daemon script', async () => {
      const res = await request(app).get('/api/agent/install.sh');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('shellscript');
      expect(res.text).toContain('Gravity Infrastructure Monitoring Agent v0.1');
      expect(res.text).toContain('/opt/gravity/runtime');
    });

    it('GET /api/agent/source/cli.js should serve Gravity CLI source', async () => {
      const res = await request(app).get('/api/agent/source/cli.js');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Gravity Infrastructure Monitoring Agent CLI');
    });

    it('POST /api/servers/token should generate secure installation token with specified server name', async () => {
      (query as jest.Mock).mockResolvedValueOnce({ rows: [] });

      const cookie = makeCookie({ id: 'user-admin', email: 'admin@uptime.local', role: 'admin' });
      const res = await request(app)
        .post('/api/servers/token')
        .set('Cookie', cookie)
        .send({
          server_name: 'test-check',
          enable_docker: true
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toMatch(/^upt_inst_/);
      expect(res.body.install_command).toContain('--name="test-check"');
      expect(res.body.install_command).toContain('--enable-docker-monitoring');
    });

    it('POST /api/agent/register should register server and prioritize explicit server_name', async () => {
      // Mock token validation query
      (query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          token: 'upt_inst_sampletoken123',
          user_id: 'user-admin',
          server_name: 'test',
          expires_at: new Date(Date.now() + 3600000),
          used: false
        }]
      });

      // Mock token used update query
      (query as jest.Mock).mockResolvedValueOnce({ rows: [] });

      // Mock server insertion query
      (query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          id: 'server-uuid-1234',
          name: 'test-check',
          api_token: 'upt_tok_persisted12345678'
        }]
      });

      const res = await request(app)
        .post('/api/agent/register')
        .send({
          token: 'upt_inst_sampletoken123',
          server_name: 'test-check',
          hostname: 'node-host-01',
          os_name: 'Linux',
          os_version: 'Ubuntu 22.04',
          cpu_cores: 4,
          total_memory_bytes: 8589934592,
          total_disk_bytes: 107374182400,
          agent_version: '0.1',
          docker_enabled: true
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.server_id).toBe('server-uuid-1234');
      expect(res.body.api_token).toBe('upt_tok_persisted12345678');
    });

    it('POST /api/agent/heartbeat should update server status to ONLINE', async () => {
      // Mock server verification query
      (query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          id: 'server-uuid-1234',
          name: 'test-check',
          hostname: 'node-host-01',
          agent_status: 'OFFLINE'
        }]
      });

      // Mock update heartbeat query
      (query as jest.Mock).mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/api/agent/heartbeat')
        .set('X-Agent-Token', 'upt_tok_persisted12345678')
        .send({
          server_id: 'server-uuid-1234',
          agent_version: '0.1',
          uptime_seconds: 3600,
          load_avg: [0.15, 0.22, 0.18]
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe('ACK');
    });

    it('POST /api/agent/metrics should ingest CPU, RAM, and Docker telemetry', async () => {
      // Mock server verification query
      (query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          id: 'server-uuid-1234',
          name: 'test-check',
          hostname: 'node-host-01',
          total_memory_bytes: 8589934592,
          total_disk_bytes: 107374182400
        }]
      });

      // Mock insert metrics query
      (query as jest.Mock).mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/api/agent/metrics')
        .set('X-Agent-Token', 'upt_tok_persisted12345678')
        .send({
          server_id: 'server-uuid-1234',
          cpu_usage_percent: 24.5,
          load_1m: 0.8,
          load_5m: 0.6,
          load_15m: 0.5,
          memory_used_bytes: 4294967296,
          memory_total_bytes: 8589934592,
          memory_usage_percent: 50.0,
          disk_used_bytes: 53687091200,
          disk_total_bytes: 107374182400,
          disk_usage_percent: 50.0,
          processes_count: 120,
          top_processes: [{ pid: 101, name: 'gravity-agent', cpu: 0.5, mem: 1.2, user: 'gravity' }],
          docker_stats: { active_containers: 2, total_containers: 2, containers: [] }
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Metrics recorded');
    });
  });
});
