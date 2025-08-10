# FinAgent MCP

A production-ready MCP (Model Context Protocol) server for financial data integration, featuring Plaid banking/investment data and Robinhood cryptocurrency trading with advanced context engineering and evidence tracking.

## About

FinAgent MCP is a polyglot financial data platform that provides LLMs with structured access to banking, investment, and cryptocurrency data through a standardized MCP interface. The system combines Node.js MCP tooling with Go-based data ingestion to deliver real-time financial insights with full observability and audit trails.

## Architecture

```
[Node MCP Server] ──► [Go Ingestion Service] ──► [External APIs]
  • Tool registry         • Plaid sync             • Plaid API
  • Context packer        • Robinhood client       • Robinhood API  
  • Evidence builder      • Webhook handlers       
  • Rate limiting         • Data encryption        

        │                       │
        ▼                       ▼
  [PostgreSQL]            [Redis Cache]
  Data storage            Rate limits
  Audit trails            Idempotency
```

**Components:**
- **Node MCP Server**: TypeScript-based tool execution and context engineering
- **Go Ingestion Service**: High-performance data synchronization and API integration  
- **PostgreSQL**: Primary data storage with full audit trails
- **Redis**: Caching, rate limiting, and idempotency locks

## Features

**Banking & Investment Tools**
- Account management and monitoring
- Transaction analysis with advanced filtering
- Spending summaries and categorization
- Investment holdings and performance tracking
- Investment transaction history

**Cryptocurrency Trading**
- Real-time crypto portfolio monitoring
- Secure order placement with safety guardrails
- Risk assessment and position sizing limits
- Dry-run mode for safe testing

**Other**
- Context packing with intelligent data ranking
- Evidence tracking for auditable data lineage
- OpenTelemetry distributed tracing
- Production-ready rate limiting and security

## Environment Variables

Create a `.env` file in the project root:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/finagent?sslmode=disable
REDIS_URL=redis://localhost:6379
PLAID_CLIENT_ID=plaid_client_id
PLAID_SECRET=plaid_secret
PLAID_ENVIRONMENT=sandbox
ROBINHOOD_USERNAME=robinhood_username
ROBINHOOD_PASSWORD=robinhood_password
ENCRYPTION_KEY=32_char_encryption_key
GO_SERVICE_URL=http://localhost:8081
MCP_SERVICE_URL=http://localhost:3001
WEB_SERVICE_URL=http://localhost:3000
JAEGER_ENDPOINT=http://localhost:14268/api/traces
NODE_ENV=development
LOG_LEVEL=info
```

## Quick Start

1. **Setup environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your actual credentials
   ```

2. **Start infrastructure:**
   ```bash
   pnpm infra:up
   pnpm db:migrate
   ```

3. **Start services:**
   ```bash
   # Terminal 1: Go service
   cd services/ingest && go run cmd/ingest/main.go
   
   # Terminal 2: MCP server
   cd apps/mcp && pnpm dev
   ```

4. **Test the setup:**
   ```bash
   curl -X POST http://localhost:3001/tools/list_accounts \
     -H "X-User-ID: dev-user-1" \
     -d '{}'
   ```

See `DEVELOPMENT.md` for detailed setup instructions and development workflows.