# Local test image only. Production deployment uses Cloudflare Workers + D1.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 8788
# Wrangler reads local secrets from .dev.vars. The file is created inside the
# disposable test container and is not copied into the image build context.
CMD ["sh", "-c", "if [ -n \"$ENCRYPTION_KEY\" ]; then umask 077; printf 'ENCRYPTION_KEY=%s\n' \"$ENCRYPTION_KEY\" > /app/.dev.vars; fi; npx wrangler d1 migrations apply shiguang-vault --local --persist-to /app/.wrangler/state && exec npx wrangler dev --ip 0.0.0.0 --port 8788 --persist-to /app/.wrangler/state"]
