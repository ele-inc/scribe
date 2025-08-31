// Removed Supabase Edge Runtime dependency for Cloud Run
import { handleDiscordInteraction } from "./discord-handler.ts";
import { handleSlackEvents } from "./slack-handler.ts";
import { config } from "./config.ts";
import { handleHttpError } from "./errors.ts";

console.log(`Function "elevenlabs-scribe-bot" up and running!`);

const port = config.port;

Deno.serve({ port }, async (req) => {
  try {
    const url = new URL(req.url);
    const pathname = url.pathname;
    
    // Log incoming request for debugging
    console.log("Incoming request method:", req.method);
    console.log("Incoming request URL:", req.url);
    console.log("Path:", pathname);
    
    // Health check endpoint
    if (pathname === "/" && req.method === "GET") {
      return new Response("ElevenLabs Scribe Bot is running!", { status: 200 });
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

    return new Response("Method not allowed", { status: 405 });
  } catch (err) {
    return handleHttpError(err as Error);
  }
});