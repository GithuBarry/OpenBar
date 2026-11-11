FROM node:26.8.1-bookworm-slim@sha256:367679cf9792759492a486e4aa4b421764d71a9546a6dae8aab81a99eb797b3e AS deps
WORKDIR /app
RUN npm install --global pnpm@11.9.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:26.8.1-bookworm-slim@sha256:367679cf9792759492a486e4aa4b421764d71a9546a6dae8aab81a99eb797b3e AS builder
WORKDIR /app
RUN npm install --global pnpm@11.9.0
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
RUN pnpm build

FROM node:26.8.1-bookworm-slim@sha256:367679cf9792759492a486e4aa4b421764d71a9546a6dae8aab81a99eb797b3e AS runner
WORKDIR /app
RUN apt-get update \
  && apt-get install --no-install-recommends -y \
    ca-certificates curl git latexmk pandoc texlive-bibtex-extra texlive-extra-utils \
    texlive-fonts-recommended texlive-latex-base texlive-latex-extra \
    texlive-latex-recommended texlive-pictures texlive-science \
  && rm -rf /var/lib/apt/lists/* \
  && latexmk -v \
  && pdflatex -version \
  && latexpand --help >/dev/null \
  && pandoc --version \
  && curl -fsSL https://github.com/latex-lsp/texlab/releases/download/v5.26.0/texlab-x86_64-linux.tar.gz -o /tmp/texlab.tar.gz \
  && echo '8697bd5e479d4584b14b7eed5c320c80ec4e1d91ebefbb6801e6bf38e9971300  /tmp/texlab.tar.gz' | sha256sum -c - \
  && tar -xzf /tmp/texlab.tar.gz -C /usr/local/bin \
  && rm /tmp/texlab.tar.gz \
  && mkdir -p /usr/local/share/licenses/texlab \
  && curl -fsSL https://raw.githubusercontent.com/latex-lsp/texlab/v5.26.0/LICENSE -o /usr/local/share/licenses/texlab/LICENSE \
  && texlab --version \
  && kpsewhich article.cls \
  && kpsewhich booktabs.sty \
  && kpsewhich amsmath.sty \
  && kpsewhich xcolor.sty \
  && groupadd --gid 1001 nodejs \
  && useradd --uid 1001 --gid 1001 --create-home --shell /usr/sbin/nologin nextjs
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
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
