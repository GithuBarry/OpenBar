FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
RUN pnpm build

FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS runner
WORKDIR /app
RUN apt-get update \
  && apt-get install --no-install-recommends -y \
    ca-certificates git latexmk pandoc texlive-bibtex-extra texlive-extra-utils \
    texlive-fonts-recommended texlive-latex-base texlive-latex-extra \
    texlive-latex-recommended texlive-pictures texlive-science \
  && rm -rf /var/lib/apt/lists/* \
  && latexmk -v \
  && pdflatex -version \
  && latexpand --help >/dev/null \
  && pandoc --version \
  && kpsewhich article.cls \
  && kpsewhich booktabs.sty \
  && kpsewhich amsmath.sty \
  && kpsewhich xcolor.sty \
  && groupadd --gid 1001 nodejs \
  && useradd --uid 1001 --gid 1001 --create-home --shell /usr/sbin/nologin nextjs
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY examples/published-papers /opt/openbar-seed/published-papers
COPY deploy/start-openbar.sh /app/deploy/start-openbar.sh
RUN mkdir -p /data/openbar /app/.next /app/deploy \
  && chown -R nextjs:nodejs /data/openbar /app/.next /app/deploy
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV OPENBARRY_CONTENT=/data/openbar
ENV OPENBAR_PUBLIC_DEMO=1
ENV OPENBAR_DEMO_SLUGS=command-v,noveltybench
ENV OPENBAR_DEMO_FIXTURE=/opt/openbar-seed/published-papers
EXPOSE 3000
USER nextjs
CMD ["/app/deploy/start-openbar.sh"]
