# Inngest Setup Guide

This guide explains how to run and test Inngest functions locally.

## Prerequisites

- Bun installed
- Project dependencies installed (`bun install`)

## Running Locally

### 1. Start the Backend Server

```bash
bun run dev
```

This starts the Elysia server at `http://localhost:8000` with the Inngest endpoint at `/inngest`.

### 2. Start the Inngest Dev Server

In a separate terminal, run:

```bash
npx inngest-cli@latest dev -u http://localhost:8000/inngest
```

This will:
- Open the Inngest Dev UI at `http://localhost:8288`
- Connect to your backend's `/inngest` endpoint
- Discover all registered functions

## Testing Functions

### Via Inngest Dev UI

1. Open `http://localhost:8288` in your browser
2. Navigate to "Functions" to see registered functions
3. Click on a function and use "Test" to trigger it manually

### Via API (Programmatic)

Send events programmatically using the Inngest client:

```typescript
import { inngest } from "./inngest";

// Send a hello world event
await inngest.send({
    name: "hello/world",
    data: {
        message: "Hello from Inngest!"
    }
});
```

## Available Functions

| Function | Event | Description |
|----------|-------|-------------|
| `hello-world` | `hello/world` | Simple hello world function that logs a message |

## Adding New Functions

1. Create a new file in `src/inngest/` (e.g., `my-function.ts`)
2. Define your event type in `src/inngest/types.ts`
3. Export your function from `src/inngest/index.ts`

### Example:

```typescript
// src/inngest/my-function.ts
import { inngest } from "./client";

export const myFunction = inngest.createFunction(
    { id: "my-function" },
    { event: "my/event" },
    async ({ event, step }) => {
        // Your logic here
        return { success: true };
    }
);
```

## Environment Variables

For production, set your Inngest keys in `.env`:

```env
INNGEST_EVENT_KEY=your-event-key
INNGEST_SIGNING_KEY=your-signing-key
```
