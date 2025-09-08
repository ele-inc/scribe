import { handleDiscordInteraction } from "./handlers/discord-handler.ts";
import { handleSlackEvents } from "./handlers/slack-handler.ts";
import { config } from "./core/config.ts";
import { textResponse, methodNotAllowed } from "./utils/http-utils.ts";

console.log(`Function "elevenlabs-scribe-bot" up and running!`);

const port = config.port;

Deno.serve({ port }, async (req) => {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // Log incoming request for debugging
  console.log("Incoming request method:", req.method);
  console.log("Path:", pathname);

  // Health check endpoint
  if (pathname === "/" && req.method === "GET") {
    return textResponse("ElevenLabs Scribe Bot is running!");
  }

  // Discord endpoint
  if (pathname === "/discord/interactions") {
    console.log("Discord request detected");
    return await handleDiscordInteraction(req);
  }

  // Slack endpoint
  if (pathname === "/slack/events" && req.method === "POST") {
    return await handleSlackEvents(req);
  }

  return methodNotAllowed(['GET', 'POST']);
});
