#!/bin/sh
# Uploads dist/ as Cloudflare Workers static assets (wrangler.jsonc). Credentials come from .env (account_id, api_token);
# the token needs Workers Scripts:Edit. Wrangler uploads only files whose content Cloudflare does not have yet.
set -e
set -a; . ./.env; set +a
export CLOUDFLARE_ACCOUNT_ID="$account_id" CLOUDFLARE_API_TOKEN="$api_token"
npx -y wrangler@4 deploy
