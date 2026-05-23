# Uptime Monitoring Web Application

A private, self-hosted web application to monitor the uptime, response time, and availability of multiple websites in real-time, built with Express, React, TypeScript, PostgreSQL, and Redis.

## Features

- **Real-Time Uptime Tracking**: Constant HTTP/HTTPS status verification with instant live updates on the client.
- **Detailed History & Metrics**: Uptime percentages, response time tracking, historical graphs, and incident records.
- **Intelligent Alert System**: State change detection (UP <-> DOWN) with immediate dispatching to channels such as email, Slack, and customizable webhooks.
- **Enterprise-Grade Security**: strict input validation, connection pooling, secure HTTP-only cookie-based session management, and robust CORS/rate-limiting safeguards.

## Architecture

```
┌─────────────────────────────────────────┐
│         Frontend (React/SPA)             │
│  - Dashboard, Settings, History, Alerts │
└──────────────────┬──────────────────────┘
                   │ API (REST/WebSocket)
┌──────────────────┴──────────────────────┐
│     Backend (Node.js/Express)            │
│  - API routes, Business logic            │
│  - WebSocket for real-time updates       │
└──────────────────┬──────────────────────┘
         │                    │
    ┌────┴────┐          ┌────┴──────┐
    │          │          │            │
┌───▼──┐  ┌────▼─────┐  ┌─▼──────┐   │
│  DB  │  │  Redis   │  │ Queue  │   │
│(PG)  │  │(Caching) │  │(Tasks) │   │
└──────┘  └──────────┘  └────────┘   │
                                   ┌──▼────────────┐
                                   │ Monitoring    │
                                   │ Service       │
                                   │(Background    │
                                   │ Workers)      │
                                   └───────────────┘
```

## Getting Started

Refer to `plan.md` for full implementation specs, milestones, and deployment guidelines.
