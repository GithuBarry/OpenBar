# OpenBar TeX compile image.
#
# Pin by digest after pulling a known-good tag:
#   docker pull texlive/texlive:latest
#   docker inspect --format='{{index .RepoDigests 0}}' texlive/texlive:latest
# Then replace the FROM line with:
#   FROM texlive/texlive@sha256:<digest>
#
# Required binaries: pdflatex, latexmk, latexpand, kpsewhich
# Packages used by OpenBar manuscripts (scheme-full covers these):
#   latexmk, hyperref, booktabs, graphicx, xspace, amsmath, amssymb,
#   natbib, biblatex, xcolor, geometry, fancyhdr, tools, listings

FROM texlive/texlive:latest

RUN kpsewhich article.cls \
  && command -v pdflatex \
  && command -v latexmk \
  && command -v latexpand
