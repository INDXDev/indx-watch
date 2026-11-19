# INDX Watch server (`iw serve`) in a container. Guide: docs/guides/self-host-node.md
#   docker build -t indx-watch .                                  # indx-watch from npm (IW_VERSION)
#   (cd packages/cli && npm pack --pack-destination ../..)        # or: pack this checkout first,
#   docker build -t indx-watch .                                  #     then the tarball is installed
#   docker run -p 127.0.0.1:4321:4321 -v "$PWD:/project" indx-watch
FROM node:22-slim

ARG IW_VERSION=latest

# git: commit and identity detection from the mounted checkout
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && git config --system --add safe.directory '*'

# LICENSE is always present, so the optional tarball glob may match nothing
COPY LICENSE indx-watch-*.tgz /tmp/pkg/
RUN set -e; \
  if ls /tmp/pkg/indx-watch-*.tgz >/dev/null 2>&1; then npm install -g /tmp/pkg/indx-watch-*.tgz; \
  else npm install -g "indx-watch@${IW_VERSION}"; fi; \
  rm -rf /tmp/pkg; npm cache clean --force; iw --help >/dev/null

ENV NODE_ENV=production
WORKDIR /project
VOLUME ["/project"]
USER node
EXPOSE 4321

ENTRYPOINT ["iw"]
CMD ["serve", "--host", "0.0.0.0"]
