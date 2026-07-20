# Whoop MCP Server

A Model Context Protocol (MCP) server for accessing Whoop fitness data. Integrate your WHOOP biometric data into Claude, LLMs, and other MCP-compatible applications.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/F1iI46?referralCode=I5P95N&utm_medium=integration&utm_source=template&utm_campaign=generic)

## Features

- **Comprehensive Overview** - All your daily metrics in one call
- **Sleep Analysis** - Deep dive into sleep performance and quality
- **Recovery Metrics** - HRV, RHR, and recovery contributors
- **Strain Tracking** - Day strain with heart rate zones and activities
- **Healthspan** - Biological age and pace of aging metrics

## Quick Start

1. **Clone the repository:**

```bash
git clone https://github.com/yourusername/whoop-mcp.git
cd whoop-mcp
```

2. **Create a `.env` file with your WHOOP credentials:**

```bash
echo "WHOOP_EMAIL='your-email@example.com'" > .env
echo "WHOOP_PASSWORD='your-password'" >> .env
echo "PORT=3000" >> .env
```

> ⚠️ **Quote your values.** Bun's `.env` parser treats an unquoted `#` as the start of an inline comment — a password containing `#` gets silently truncated and login fails with "Incorrect username or password".

3. **Install dependencies:**

```bash
bun install
```

4. **Log in once to get a refresh token (required if your account uses email OTP):**

Whoop requires an email OTP code on password login. Run the interactive login script once — it prompts for the code sent to your email and saves a long-lived `WHOOP_REFRESH_TOKEN` to your `.env`:

```bash
bun run login
```

After this, the server authenticates with the refresh token and never needs the OTP again. If the refresh token ever expires, just re-run `bun run login`.

5. **Start the server:**

```bash
bun run start
```

Or for development with hot reload:

```bash
bun run dev
```

The server will run on `http://localhost:3000/mcp` by default.

## Docker Deployment

1. **Create a `.env` file with your credentials:**

```bash
cp .env.example .env
# Edit .env with your actual credentials
```

2. **Build the Docker image:**

```bash
docker build -t whoop-mcp .
```

3. **Run the container:**

```bash
docker run -d \
  --name whoop-mcp \
  whoop-mcp
```

The `--env-file .env` flag automatically loads all environment variables from your `.env` file.

4. **View logs:**

```bash
docker logs -f whoop-mcp
```

5. **Stop the container:**

```bash
docker stop whoop-mcp
```

The Docker image is based on the official Bun Alpine image. The container includes health checks to monitor the server's status.

## Smithery Deployment

This server is configured to work with [Smithery](https://smithery.ai/), a platform for deploying MCP servers. When deployed on Smithery:

1. **Configuration via Query Parameters**: Smithery passes your credentials as query parameters to the `/mcp` endpoint (defined in `smithery.yaml`):

   - `whoopRefreshToken` - Refresh token from `bun run login` (recommended — required if your account uses email OTP)
   - `whoopEmail` - Your Whoop account email
   - `whoopPassword` - Your Whoop account password
   - `mcpAuthToken` - Optional authentication token

2. **Automatic Configuration**: The server automatically extracts these from query parameters when running on Smithery, so you don't need to set environment variables manually.

3. **Deploy Button**: Use the Railway deploy button above for quick deployment, or follow [Smithery's documentation](https://smithery.ai/docs) for other deployment options.

The `smithery.yaml` file in the repository root defines the configuration schema that Smithery uses to collect your credentials securely.

## Configuration

### Credentials Configuration

The server supports two methods for providing credentials:

1. **Query Parameters** (used by Smithery): Pass credentials as query parameters to the `/mcp` endpoint

   - `whoopRefreshToken` - Refresh token obtained via `bun run login` (recommended)
   - `whoopEmail` - Your Whoop account email
   - `whoopPassword` - Your Whoop account password
   - `mcpAuthToken` - Optional authentication token

2. **Environment Variables** (used for local/Docker deployment):

| Variable              | Required | Default | Description                                                      |
| --------------------- | -------- | ------- | ---------------------------------------------------------------- |
| `WHOOP_REFRESH_TOKEN` | Yes\*    | -       | Refresh token saved by `bun run login` (recommended)             |
| `WHOOP_EMAIL`         | Yes\*    | -       | Your Whoop account email                                         |
| `WHOOP_PASSWORD`      | Yes\*    | -       | Your Whoop account password (quote it in `.env` if it has a `#`) |
| `MCP_AUTH_TOKEN`      | No       | -       | Optional authentication token for MCP requests                   |
| `PORT`                | No       | 3000    | Server port                                                      |

\* Either `WHOOP_REFRESH_TOKEN` or `WHOOP_EMAIL`+`WHOOP_PASSWORD` is required. Password-only login works exclusively for accounts without email OTP enabled — most accounts need the refresh token (see Quick Start step 4).

The server will check query parameters first, then fall back to environment variables if not provided.

**Note:** `bun --watch` (the `dev` script) does not re-read `.env` on reload — restart the server after changing environment variables.

### Optional Authentication

To protect your MCP server from unauthorized access, you can set the `MCP_AUTH_TOKEN` environment variable. When set, all requests to the `/mcp` endpoint must include a matching Bearer token:

```bash
export MCP_AUTH_TOKEN='your-secret-token-here'
```

Or add it to your `.env` file:

```bash
echo "MCP_AUTH_TOKEN=your-secret-token-here" >> .env
```

Clients must then include the token in the Authorization header:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer your-secret-token-here" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

**Note:** If `MCP_AUTH_TOKEN` is not set, the server will accept all requests (useful for local development).

## Using with Claude Desktop

Add this configuration to your Claude Desktop config file:

**MacOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

**Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

### Without Authentication (Local Development)

```json
{
  "mcpServers": {
    "whoop": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/whoop-mcp/index.ts"],
      "env": {
        "WHOOP_REFRESH_TOKEN": "your-refresh-token-from-bun-run-login"
      }
    }
  }
}
```

### With Authentication (Recommended)

```json
{
  "mcpServers": {
    "whoop": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/whoop-mcp/index.ts"],
      "env": {
        "WHOOP_REFRESH_TOKEN": "your-refresh-token-from-bun-run-login",
        "MCP_AUTH_TOKEN": "your-secret-token-here"
      }
    }
  }
}
```

Replace `/absolute/path/to/whoop-mcp/` with the actual path to this directory.

## Available Tools

The server provides five main tools for accessing your Whoop data:

### whoop_get_overview

Retrieves comprehensive Whoop overview data for a specific date in a single API call.

**Parameters:**

- `date` (optional) - Date in YYYY-MM-DD format. Defaults to today.

**Returns:**

- **Cycle Info**: Cycle ID, day, date display, sleep state
- **Live Metrics**: Recovery score, day strain, sleep hours, calories burned
- **Gauges**: All score gauges from the home screen
- **Activities**: Today's activities with scores and times
- **Key Statistics**: HRV, RHR, VO2 Max, respiratory rate, steps with 30-day trends
- **Journal**: Journal completion status

**Example usage:**

```
"Can you check my Whoop data for today?"
"What was my recovery score on 2024-01-15?"
"Show me my Whoop stats from yesterday"
"How many steps did I take and what were my activities today?"
```

### whoop_get_sleep

Retrieves detailed sleep analysis and performance metrics.

**Parameters:**

- `date` (optional) - Date in YYYY-MM-DD format. Defaults to today.

**Returns:**

- Sleep performance score
- Hours vs needed
- Sleep consistency
- Sleep efficiency
- High sleep stress percentage
- Personalized insights and recommendations

**Example usage:**

```
"How did I sleep last night?"
"What's my sleep performance for October 27?"
"Why is my sleep score low today?"
```

### whoop_get_recovery

Retrieves comprehensive recovery deep dive analysis including contributors and trends.

**Parameters:**

- `date` (optional) - Date in YYYY-MM-DD format. Defaults to today.

**Returns:**

- Recovery score (0-100%)
- Recovery contributors:
  - Heart Rate Variability (HRV)
  - Resting Heart Rate (RHR)
  - Respiratory Rate
  - Sleep Performance
- Trend indicators vs 30-day baseline
- Personalized coach insights

**Example usage:**

```
"What's my recovery score today?"
"Show me my recovery analysis for yesterday"
"How is my HRV trending compared to my baseline?"
```

### whoop_get_strain

Retrieves comprehensive strain deep dive analysis including contributors, activities, and trends.

**Parameters:**

- `date` (optional) - Date in YYYY-MM-DD format. Defaults to today.

**Returns:**

- Strain score with target and optimal ranges
- Strain contributors:
  - Heart Rate Zones 1-3
  - Heart Rate Zones 4-5
  - Strength Activity Time
  - Steps
- Today's activities with individual strain scores
- Trend indicators vs 30-day baseline
- Personalized coach insights

**Example usage:**

```
"What's my strain score today?"
"Show me my strain analysis and activities"
"How much time did I spend in heart rate zones 4-5?"
"Did I reach my optimal strain target?"
```

### whoop_get_healthspan

Retrieves comprehensive healthspan analysis including WHOOP Age (biological age) and pace of aging metrics.

**Parameters:**

- `date` (optional) - Date in YYYY-MM-DD format. Defaults to today.

**Returns:**

- WHOOP Age (biological age)
- Age status (Younger, Same, Older vs. chronological age)
- Years difference from chronological age
- Pace of aging (e.g., 0.5x = aging slower than average)
- Comparison with previous period
- Weekly date range for healthspan measurement

**Example usage:**

```
"What's my WHOOP Age?"
"Show me my biological age and healthspan data"
"How fast am I aging compared to average?"
"Am I aging slower or faster than my chronological age?"
```

## How It Works

Whoop uses AWS Cognito for authentication, and most accounts require an email OTP challenge on password login. The server handles this with a two-phase flow:

1. **One-time setup** (`bun run login`): logs in with email/password, prompts for the OTP code sent to your email, and saves the resulting long-lived `WHOOP_REFRESH_TOKEN` to `.env`
2. **Runtime**: the server exchanges the refresh token for a short-lived access token (`REFRESH_TOKEN_AUTH`) — no password or OTP needed
3. Access tokens are stored in memory only and automatically renewed before they expire
4. Failed requests are retried after re-authentication

If no refresh token is configured, the server falls back to direct email/password login, which only works for accounts without email OTP enabled.

## Security

### Best Practices

- **Never commit** your `.env` file or share your WHOOP credentials — the `WHOOP_REFRESH_TOKEN` grants full account access, treat it like a password
- The server stores Whoop access tokens in memory only (they expire and are renewed automatically)
- **Use `MCP_AUTH_TOKEN`** when exposing the server to a network or untrusted clients
- Generate strong, random tokens for `MCP_AUTH_TOKEN` (e.g., using `openssl rand -hex 32`)
- When running in production or on a network, **always** set `MCP_AUTH_TOKEN`

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT - see LICENSE file for details
