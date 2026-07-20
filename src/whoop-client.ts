import type {
  WhoopConfig,
  WhoopHeaders,
  HomeResponse,
  LoginResponse,
  TokenData,
} from "./types";

export const WHOOP_CLIENT_ID = "475b3ab3-7326-47f7-aedd-762f3a425822";

/**
 * Call Whoop's Cognito auth endpoint (InitiateAuth / RespondToAuthChallenge).
 */
// ponytail: auth always hits prod, ignores config.baseUrl (only used for API calls)
export async function cognitoCall(
  target: "InitiateAuth" | "RespondToAuthChallenge",
  payload: object
): Promise<LoginResponse> {
  const response = await fetch("https://api.prod.whoop.com/auth-service/v3/whoop", {
    method: "POST",
    headers: {
      Accept: "*/*",
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": `AWSCognitoIdentityProviderService.${target}`,
      // Whoop's WAF 403s non-iOS user agents; impersonate the AWS Swift SDK
      "User-Agent":
        "aws-sdk-swift/1.5.86 ua/2.1 api/cognito_identity_provider#1.5.86 os/ios#26.3.1 lang/swift#5.10 m/D,N,Z,b",
      "amz-sdk-invocation-id": crypto.randomUUID(),
      "amz-sdk-request": "attempt=1; max=1",
      "Accept-Language": "en-US,en;q=0.9",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${target} failed: ${response.status} ${response.statusText} — ${body}`);
  }

  return (await response.json()) as LoginResponse;
}

export class WhoopClient {
  private config: WhoopConfig;
  private baseUrl: string;
  private tokenData: TokenData | null = null;

  constructor(config: WhoopConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || "https://api.prod.whoop.com";
  }

  /**
   * Get an access token — via refresh token if configured, otherwise
   * email/password (only works for accounts without email OTP enabled).
   */
  async login(): Promise<void> {
    try {
      const data = this.config.refreshToken
        ? await cognitoCall("InitiateAuth", {
            AuthFlow: "REFRESH_TOKEN_AUTH",
            ClientId: WHOOP_CLIENT_ID,
            AuthParameters: { REFRESH_TOKEN: this.config.refreshToken },
          })
        : await this.passwordLogin();

      if (!data.AuthenticationResult) {
        throw new Error(
          data.ChallengeName
            ? `Whoop requires a ${data.ChallengeName} challenge — run \`bun run login\` once to obtain WHOOP_REFRESH_TOKEN`
            : "No authentication result received"
        );
      }

      this.tokenData = {
        accessToken: data.AuthenticationResult.AccessToken,
        expiresAt: Date.now() + data.AuthenticationResult.ExpiresIn * 1000,
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to login: ${error.message}`);
      }
      throw error;
    }
  }

  private async passwordLogin(): Promise<LoginResponse> {
    const { email, password } = this.config;
    if (!email || !password) {
      throw new Error("Email and password are required for login");
    }
    return cognitoCall("InitiateAuth", {
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: WHOOP_CLIENT_ID,
      AuthParameters: { USERNAME: email, PASSWORD: password },
    });
  }

  /**
   * Ensure we have a valid access token, logging in if necessary
   */
  private async ensureValidToken(): Promise<void> {
    if (!this.tokenData) {
      await this.login();
      return;
    }

    const expiresInMs = this.tokenData.expiresAt - Date.now();
    if (expiresInMs < 5 * 60 * 1000) {
      await this.login();
    }
  }

  private async getHeaders(): Promise<WhoopHeaders> {
    await this.ensureValidToken();

    if (!this.tokenData) {
      throw new Error("No valid authentication token available");
    }

    return {
      Host: "api.prod.whoop.com",
      Authorization: `Bearer ${this.tokenData.accessToken}`,
      Accept: "*/*",
      "User-Agent": "iOS",
      "Content-Type": "application/json",
      "X-WHOOP-Device-Platform": "iOS",
      "X-WHOOP-Time-Zone": Intl.DateTimeFormat().resolvedOptions().timeZone,
      Locale: "en_US",
      Currency: "USD",
    };
  }

  /**
   * Get comprehensive home data for a specific date
   */
  async getHomeData(date?: string): Promise<HomeResponse> {
    const dateParam = date || new Date().toISOString().split("T")[0];
    const url = `${this.baseUrl}/home-service/v1/home?date=${dateParam}`;

    let retried = false;

    while (true) {
      try {
        const headers = await this.getHeaders();
        const response = await fetch(url, {
          method: "GET",
          headers: Object.fromEntries(
            Object.entries(headers).map(([key, value]) => [
              key,
              value as string,
            ])
          ),
        });

        if (!response.ok) {
          if (response.status === 401 && !retried) {
            retried = true;
            await this.login();
            continue;
          }

          throw new Error(
            `Whoop API error: ${response.status} ${response.statusText}`
          );
        }

        const data = await response.json();
        return data as HomeResponse;
      } catch (error) {
        if (
          retried ||
          !(error instanceof Error && error.message.includes("401"))
        ) {
          if (error instanceof Error) {
            throw new Error(`Failed to fetch home data: ${error.message}`);
          }
          throw error;
        }

        retried = true;
        await this.login();
      }
    }
  }

  /**
   * Get sleep deep dive data for a specific date
   */
  async getSleepDeepDive(date?: string): Promise<any> {
    const dateParam = date || new Date().toISOString().split("T")[0];
    const url = `${this.baseUrl}/home-service/v1/deep-dive/sleep?date=${dateParam}`;

    let retried = false;

    while (true) {
      try {
        const headers = await this.getHeaders();
        const response = await fetch(url, {
          method: "GET",
          headers: Object.fromEntries(
            Object.entries(headers).map(([key, value]) => [
              key,
              value as string,
            ])
          ),
        });

        if (!response.ok) {
          if (response.status === 401 && !retried) {
            retried = true;
            await this.login();
            continue;
          }

          throw new Error(
            `Whoop API error: ${response.status} ${response.statusText}`
          );
        }

        const data = await response.json();
        return data;
      } catch (error) {
        if (
          retried ||
          !(error instanceof Error && error.message.includes("401"))
        ) {
          if (error instanceof Error) {
            throw new Error(`Failed to fetch sleep data: ${error.message}`);
          }
          throw error;
        }

        retried = true;
        await this.login();
      }
    }
  }

  /**
   * Get recovery deep dive data for a specific date
   */
  async getRecoveryDeepDive(date?: string): Promise<any> {
    const dateParam = date || new Date().toISOString().split("T")[0];
    const url = `${this.baseUrl}/home-service/v1/deep-dive/recovery?date=${dateParam}`;

    let retried = false;

    while (true) {
      try {
        const headers = await this.getHeaders();
        const response = await fetch(url, {
          method: "GET",
          headers: Object.fromEntries(
            Object.entries(headers).map(([key, value]) => [
              key,
              value as string,
            ])
          ),
        });

        if (!response.ok) {
          if (response.status === 401 && !retried) {
            retried = true;
            await this.login();
            continue;
          }

          throw new Error(
            `Whoop API error: ${response.status} ${response.statusText}`
          );
        }

        const data = await response.json();
        return data;
      } catch (error) {
        if (
          retried ||
          !(error instanceof Error && error.message.includes("401"))
        ) {
          if (error instanceof Error) {
            throw new Error(`Failed to fetch recovery data: ${error.message}`);
          }
          throw error;
        }

        retried = true;
        await this.login();
      }
    }
  }

  /**
   * Get strain deep dive data for a specific date
   */
  async getStrainDeepDive(date?: string): Promise<any> {
    const dateParam = date || new Date().toISOString().split("T")[0];
    const url = `${this.baseUrl}/home-service/v1/deep-dive/strain?date=${dateParam}`;

    let retried = false;

    while (true) {
      try {
        const headers = await this.getHeaders();
        const response = await fetch(url, {
          method: "GET",
          headers: Object.fromEntries(
            Object.entries(headers).map(([key, value]) => [
              key,
              value as string,
            ])
          ),
        });

        if (!response.ok) {
          if (response.status === 401 && !retried) {
            retried = true;
            await this.login();
            continue;
          }

          throw new Error(
            `Whoop API error: ${response.status} ${response.statusText}`
          );
        }

        const data = await response.json();
        return data;
      } catch (error) {
        if (
          retried ||
          !(error instanceof Error && error.message.includes("401"))
        ) {
          if (error instanceof Error) {
            throw new Error(`Failed to fetch strain data: ${error.message}`);
          }
          throw error;
        }

        retried = true;
        await this.login();
      }
    }
  }

  /**
   * Get healthspan data for a specific date
   */
  async getHealthspan(date?: string): Promise<any> {
    const dateParam = date || new Date().toISOString().split("T")[0];
    const url = `${this.baseUrl}/healthspan-service/v1/healthspan/bff?date=${dateParam}`;

    let retried = false;

    while (true) {
      try {
        const headers = await this.getHeaders();
        const response = await fetch(url, {
          method: "GET",
          headers: Object.fromEntries(
            Object.entries(headers).map(([key, value]) => [
              key,
              value as string,
            ])
          ),
        });

        if (!response.ok) {
          if (response.status === 401 && !retried) {
            retried = true;
            await this.login();
            continue;
          }

          throw new Error(
            `Whoop API error: ${response.status} ${response.statusText}`
          );
        }

        const data = await response.json();
        return data;
      } catch (error) {
        if (
          retried ||
          !(error instanceof Error && error.message.includes("401"))
        ) {
          if (error instanceof Error) {
            throw new Error(
              `Failed to fetch healthspan data: ${error.message}`
            );
          }
          throw error;
        }

        retried = true;
        await this.login();
      }
    }
  }

  /**
   * Format home data into a human-readable string
   */
  formatHomeData(data: HomeResponse): string {
    const metadata = data.metadata;
    const live = metadata.whoop_live_metadata;
    const cycle = metadata.cycle_metadata;

    const lines = [
      "🏠 WHOOP HOME DATA",
      "══════════════════",
      "",
      `📅 Date: ${cycle.cycle_day} (${cycle.cycle_date_display})`,
      `🔄 Cycle ID: ${cycle.cycle_id}`,
      `💤 Sleep State: ${cycle.sleep_state}`,
      "",
      "📊 LIVE METRICS",
      "───────────────",
      `  Recovery: ${live.recovery_score}%`,
      `  Strain: ${live.day_strain.toFixed(1)}`,
      `  Sleep: ${(live.ms_of_sleep / (1000 * 60 * 60)).toFixed(1)} hours`,
      `  Calories: ${live.calories}`,
      "",
    ];

    // Add gauges from header
    if (data.header?.content?.gauges) {
      lines.push("🎯 SCORES", "─────────");
      data.header.content.gauges.forEach((gauge) => {
        lines.push(
          `  ${gauge.title}: ${gauge.score_display}${gauge.score_display_suffix || ""} (${Math.round(gauge.gauge_fill_percentage * 100)}%)`
        );
      });
      lines.push("");
    }

    return lines.join("\n");
  }
}
