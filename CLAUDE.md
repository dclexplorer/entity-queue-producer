# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the Entity Queue Producer service for Decentraland. It monitors Catalyst nodes for new entity deployments (scenes, wearables, emotes) and publishes them to AWS SNS topics for downstream processing.

## Development Commands

### Building and Running
```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run the application (requires build first)
npm start

# Run in development (build then start)
npm run build && npm start
```

### Testing and Code Quality
```bash
# Run all tests with coverage
npm test

# Check code style and linting
npm run lint:check
```

### Running a Single Test
```bash
# Run a specific test file
npm test -- test/integration/controllers.spec.ts

# Run tests matching a pattern
npm test -- --testNamePattern="should return 200"
```

## Architecture

This project uses the **Well-Known Components** pattern for dependency injection and lifecycle management. All components are defined in `src/types.ts` and initialized in `src/components.ts`.

### Key Components

1. **Synchronizer** (`src/adapters/synchronizer.ts`): Polls content servers for new deployments
2. **Deployer** (`src/adapters/deployer.ts`): Processes entities and publishes to SNS
3. **SNS Adapters** (`src/adapters/sns-adapter.ts`): Publishes to different AWS SNS topics
4. **World Sync Service** (`src/adapters/worlds-sync.ts`): Background service for syncing Decentraland Worlds
5. **Storage** (`src/adapters/storage.ts`): Tracks processed entities (supports S3 and local filesystem)

### API Endpoints

- `GET /ping` - Health check endpoint
- `POST /queue-task` - Queue entity deployment task (requires Authorization header)

### Entity Processing Flow

1. Synchronizer polls content servers for pointer changes
2. Downloads entity deployments via job queue
3. Filters scenes by geographic rectangle (if configured)
4. Publishes to appropriate SNS topic:
   - Scenes → `PRIORITY_SCENES_SNS_ARN` or `SCENES_SNS_ARN`
   - Wearables/Emotes → `WEARABLES_EMOTES_SNS_ARN`
5. Marks entity as processed in storage

### Environment Configuration

Key environment variables:
- `CONTENT_SERVERS_LIST` - Comma-separated list of content server URLs
- `AWS_S3_BUCKET` - S3 bucket for storage (optional, defaults to local)
- `SCENES_SNS_ARN` - SNS topic for scene deployments
- `PRIORITY_SCENES_SNS_ARN` - SNS topic for priority scenes
- `WEARABLES_EMOTES_SNS_ARN` - SNS topic for wearables/emotes
- `ENTITIES_SCENE_RECT` - Geographic filter for scenes (format: "x1,y1,x2,y2")

### Testing Approach

The project uses Jest for testing. Integration tests are located in `test/integration/`. When adding new features:
1. Add unit tests for new adapters/components
2. Update integration tests if adding new endpoints
3. Mock external dependencies (AWS SNS, HTTP requests)

### Error Handling

- HTTP errors are categorized as retryable (5xx, 429) or non-retryable (4xx)
- Background services implement retry logic with exponential backoff
- Unhandled promise rejections crash the process (for container restart)
- All errors are logged with context using the structured logger

### Adding New Entity Types

To add support for a new entity type:
1. Create a new SNS adapter in `src/adapters/`
2. Add the adapter to `AppComponents` in `src/types.ts`
3. Initialize it in `src/components.ts`
4. Update the deployer logic in `src/adapters/deployer.ts`
5. Add corresponding SNS topic ARN to environment configuration