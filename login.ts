// One-time interactive login: handles Whoop's EMAIL_OTP challenge and saves
// the refresh token to .env. Run with: bun run login
import { WHOOP_CLIENT_ID, cognitoCall } from "./src/whoop-client";

const email = process.env.WHOOP_EMAIL || prompt("Whoop email:");
const password = process.env.WHOOP_PASSWORD || prompt("Whoop password:");
if (!email || !password) {
  console.error("Email and password are required (WHOOP_EMAIL/WHOOP_PASSWORD or prompt)");
  process.exit(1);
}

const init = await cognitoCall("InitiateAuth", {
  AuthFlow: "USER_PASSWORD_AUTH",
  ClientId: WHOOP_CLIENT_ID,
  AuthParameters: { USERNAME: email, PASSWORD: password },
});

let result = init.AuthenticationResult;

if (!result && init.ChallengeName === "EMAIL_OTP") {
  const code = prompt(
    `OTP code sent to ${init.ChallengeParameters.CODE_DELIVERY_DESTINATION}:`
  );
  if (!code) {
    console.error("No code entered");
    process.exit(1);
  }
  const challenge = await cognitoCall("RespondToAuthChallenge", {
    ChallengeName: "EMAIL_OTP",
    ClientId: WHOOP_CLIENT_ID,
    Session: init.Session,
    ChallengeResponses: {
      USERNAME: email,
      EMAIL_OTP_CODE: code.trim(),
    },
  });
  result = challenge.AuthenticationResult;
}

if (!result?.RefreshToken) {
  console.error("Login did not return a refresh token:", JSON.stringify(init).slice(0, 300));
  process.exit(1);
}

const envFile = Bun.file(".env");
let env = (await envFile.exists()) ? await envFile.text() : "";
env = env.replace(/^WHOOP_REFRESH_TOKEN=.*\n?/m, "");
if (env && !env.endsWith("\n")) env += "\n";
env += `WHOOP_REFRESH_TOKEN='${result.RefreshToken}'\n`;
await Bun.write(".env", env);

console.log("✅ WHOOP_REFRESH_TOKEN saved to .env — restart the server to pick it up.");
