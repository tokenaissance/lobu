# Shared Agent Instructions

## Package Overview
Common utilities and infrastructure for all packages. Foundation for logging, database, encryption.

## Core Files & Responsibilities

### Infrastructure (`src/`)
- `logger/index.ts`: Structured logging with configurable levels
- `config/index.ts`: Environment-based configuration management
- `database/`: PostgreSQL connection pooling and RLS utilities
- `sentry.ts`: Error monitoring and reporting

### Error Management (`src/errors/`)
- `base-error.ts`: Base error class with structured metadata
- `*-errors.ts`: Service-specific error types for dispatcher/orchestrator/worker

### Security (`src/utils/`)
- `encryption.ts`: AES-256-GCM encryption for sensitive data (tokens, secrets)

### Testing (`src/testing/`)
- `mock-factories.ts`: Test data generation for all entity types
- `test-helpers.ts`: Database setup/teardown, common test utilities

### Session Management
- `session-utils.ts`: Claude session configuration and consistency utilities

## PostgreSQL Integration
- Connection pooling with automatic RLS context setting
- Row Level Security (RLS) policies for user data isolation
- Helper functions for secure database operations

## Usage Patterns
- Import from package root: `import { createLogger } from '@peerbot/shared'`
- All packages use shared error types and logging configuration
- Database access through shared connection pooling
- Encryption utilities for storing sensitive data (GitHub tokens, API keys)

## Environment Variables
- `DATABASE_URL`: PostgreSQL connection string
- `LOG_LEVEL`: Logging verbosity (debug, info, warn, error)  
- `NODE_ENV`: Environment type (development, production, test)
- `SENTRY_DSN`: Error monitoring endpoint (optional)