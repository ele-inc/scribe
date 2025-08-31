# ElevenLabs Scribe Bot for Slack

This is a Slack bot that uses the [ElevenLabs Scribe API](https://elevenlabs.io/speech-to-text) to transcribe audio and video files uploaded by users. It's built with Deno and runs on Supabase Edge Functions.

## Features

- Transcribes audio and video files when mentioned in Slack
- **NEW:** Supports Google Drive video links for transcription
- Supports speaker diarization to identify different speakers
- Automatic timestamp insertion for better navigation
- Audio event detection (music, laughter, etc.)
- Sends transcripts back as text files in the message thread
- Logs transcription requests and results to a Supabase table

## Transcription Options

You can customize the transcription by adding options when mentioning the bot:

- `--no-diarize` - Disable speaker identification (default: enabled)
- `--no-timestamp` - Disable timestamps (default: enabled)
- `--no-audio-events` - Disable audio event detection (default: enabled)
- `--num-speakers N` - Specify the number of speakers (1-32, default: 2 when diarization is enabled)

Example:
```
@bot transcribe this file --no-timestamp --no-diarize
@bot transcribe this file --num-speakers 3
@bot https://drive.google.com/file/d/xxxxx/view --num-speakers 4
```

**Note:** The `--num-speakers` option only works when speaker diarization is enabled (default). If you use `--no-diarize`, the num-speakers setting will be ignored.

## Project Structure

```
src/
├── index.ts          # Main entry point and Slack event handler
├── scribe.ts         # ElevenLabs Scribe API integration
├── slack.ts          # Slack API utilities
├── types.ts          # TypeScript type definitions
└── utils.ts          # Helper functions for text processing
```

## Tech Stack

- [Deno](https://deno.land/) - JavaScript/TypeScript runtime
- [Google Cloud Run](https://cloud.google.com/run) - Container hosting platform
- [ElevenLabs Scribe API](https://elevenlabs.io/docs/api-reference/speech-to-text) - Speech-to-text transcription
- Slack Events API - Bot event handling

## Setup

### Prerequisites

- [Deno](https://deno.land/manual/getting_started/installation) installed
- [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) installed
- An ElevenLabs account and API key.
- A Google Cloud project with Cloud Run enabled.
- A Slack app with bot token and signing secret.

### 1. Clone the repository

```bash
git clone <repository-url>
cd <repository-name>
```

### 2. Set up environment variables

Create a `.env` file in the project root directory and add the following environment variables.

```
ELEVENLABS_API_KEY="your-elevenlabs-api-key"
SLACK_BOT_TOKEN="your-slack-bot-token"
SLACK_SIGNING_SECRET="your-slack-signing-secret"
DISCORD_APPLICATION_ID="your-discord-app-id"
DISCORD_PUBLIC_KEY="your-discord-public-key"
DISCORD_BOT_TOKEN="your-discord-bot-token"
GOOGLE_SERVICE_ACCOUNT_KEY='{"type":"service_account","project_id":"..."}'  # Google service account JSON
```

### 3. Deploy to Cloud Run

Deploy the bot to Google Cloud Run:

```bash
make deploy
```

Or manually:

```bash
gcloud run deploy scribe-bot \
  --source . \
  --region asia-northeast1 \
  --allow-unauthenticated
```

### 4. Set up the Slack App

1. Create a new Slack app at https://api.slack.com/apps
2. Go to "OAuth & Permissions" and add the following bot token scopes:
   - `app_mentions:read` - To detect when the bot is mentioned
   - `files:read` - To read file information
   - `files:write` - To upload transcript files
   - `chat:write` - To send messages
3. Install the app to your workspace and copy the Bot User OAuth Token
4. Go to "Event Subscriptions" and enable events
5. Set the Request URL to your Cloud Run URL:
   ```
   https://YOUR-CLOUD-RUN-URL/slack/events
   ```
6. Subscribe to the following bot events:
   - `app_mention` - To detect when the bot is mentioned with files
7. Go to "Basic Information" and copy the Signing Secret

The Cloud Run URL can be found in the output of the `gcloud run deploy` command or in your Google Cloud Console.

## Usage

### With Slack file uploads:
1. Upload an audio or video file to a Slack channel
2. Mention the bot in the same message or as a reply
3. (Optional) Add transcription options like `--no-timestamp` or `--no-diarize`
4. The bot will process the file and reply with a transcript text file

### With Google Drive links:
1. Share a Google Drive video/audio file link in a message
2. Mention the bot in the same message with the link
3. (Optional) Add transcription options
4. The bot will download from Google Drive and transcribe

Example: `@bot https://drive.google.com/file/d/xxxxx/view --num-speakers 3`

### Supported File Formats

- Audio: MP3, WAV, M4A, AAC, OGG, WebM
- Video: MP4, MOV, AVI, MPEG, WebM

### Output Format

The transcript will be formatted based on your options:

**With speaker diarization (default):**
```
[0:00] speaker_0: こんにちは、今日の会議を始めます。
[0:05] speaker_1: よろしくお願いします。
```

**Without speaker diarization:**
```
[0:00] こんにちは、今日の会議を始めます。
[0:05] よろしくお願いします。
```

**Without timestamps:**
```
speaker_0: こんにちは、今日の会議を始めます。
speaker_1: よろしくお願いします。
```
