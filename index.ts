import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { createWhoopMcpServer } from "./src/server";
import { WhoopClient } from "./src/whoop-client";
import { getDaySummaries, getAllTimeSummaries } from "./src/day-summary";

const app = express();
app.use(express.json());

// ---- Dashboard (local web app, uses env credentials) ----

const dashboardClient = new WhoopClient({
  email: process.env.WHOOP_EMAIL,
  password: process.env.WHOOP_PASSWORD,
  refreshToken: process.env.WHOOP_REFRESH_TOKEN,
});

// Same optional token as the MCP endpoint, passed as ?token= so the browser can send it
function dashboardAuthorized(req: express.Request): boolean {
  const expected = process.env.MCP_AUTH_TOKEN;
  return !expected || req.query.token === expected;
}

app.get("/dashboard", (req, res) => {
  if (!dashboardAuthorized(req)) {
    return res.status(401).send("Unauthorized: add ?token=<MCP_AUTH_TOKEN> to the URL");
  }
  res.sendFile("dashboard.html", { root: "./public" });
});

app.get("/api/days", async (req, res) => {
  if (!dashboardAuthorized(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    if (req.query.days === "all") {
      return res.json(await getAllTimeSummaries(dashboardClient));
    }
    const days = Math.min(365, Math.max(1, parseInt(String(req.query.days)) || 60));
    const dates: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dates.push(d.toLocaleDateString("en-CA"));
    }
    res.json(await getDaySummaries(dashboardClient, dates));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "fetch failed" });
  }
});

app.post("/mcp", async (req, res) => {
  // Extract config from query parameters (Smithery passes configSchema values as query params)
  const whoopEmail =
    (req.query.whoopEmail as string) || process.env.WHOOP_EMAIL;
  const whoopPassword =
    (req.query.whoopPassword as string) || process.env.WHOOP_PASSWORD;
  const whoopRefreshToken =
    (req.query.whoopRefreshToken as string) || process.env.WHOOP_REFRESH_TOKEN;
  const mcpAuthToken =
    (req.query.mcpAuthToken as string) || process.env.MCP_AUTH_TOKEN;

  // Validate required credentials
  if (!whoopRefreshToken && (!whoopEmail || !whoopPassword)) {
    return res.status(400).json({
      error: "Bad Request",
      message:
        "whoopRefreshToken or whoopEmail+whoopPassword are required (via query params or environment variables)",
    });
  }

  // Optional authentication check
  if (mcpAuthToken) {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Authorization header is required",
      });
    }

    const [scheme, token] = authHeader.split(" ");

    if (scheme !== "Bearer" || !token) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Invalid authorization format. Use 'Bearer <token>'",
      });
    }

    if (token !== mcpAuthToken) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Invalid authentication token",
      });
    }
  }

  // Create server instance with credentials from query params or env vars
  const server = createWhoopMcpServer({
    email: whoopEmail,
    password: whoopPassword,
    refreshToken: whoopRefreshToken,
  });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => {
    transport.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const port = parseInt(process.env.PORT || "3000");
app
  .listen(port, () => {
    console.log(`Whoop MCP Server running on http://localhost:${port}/mcp`);
    console.log(
      `\nConfiguration: Credentials and auth token should be provided via query parameters`
    );
    console.log(`  - whoopEmail: Required`);
    console.log(`  - whoopPassword: Required`);
    console.log(
      `  - mcpAuthToken: Optional (enables Bearer token authentication)`
    );
    console.log(`\nAlternatively, use environment variables:`);
    console.log(`  - WHOOP_EMAIL`);
    console.log(`  - WHOOP_PASSWORD`);
    console.log(`  - MCP_AUTH_TOKEN`);
    console.log(`\nAvailable tools:`);
    console.log(
      `  - whoop_get_overview: Comprehensive overview with metrics, activities & stats`
    );
    console.log(`  - whoop_get_sleep: Detailed sleep analysis and performance`);
    console.log(
      `  - whoop_get_recovery: Recovery score with HRV, RHR & trends`
    );
    console.log(
      `  - whoop_get_strain: Strain score with HR zones & activities`
    );
    console.log(`  - whoop_get_healthspan: Biological age & pace of aging`);
  })
  .on("error", (error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
