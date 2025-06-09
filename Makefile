#!make

deploy:
	supabase functions deploy --no-verify-jwt scribe-bot

reload-cache:
	deno cache --reload ./supabase/functions/scribe-bot/index.ts
