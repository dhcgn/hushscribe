#!/usr/bin/env bash
# Runs after the container is created: project dependencies and the browser
# the e2e suite drives. `--with-deps` installs Chromium's system libraries
# through the same passwordless sudo.
set -euo pipefail

# No spinners or progress bars: the output goes to a log, not a terminal.
export CI=true NPM_CONFIG_PROGRESS=false NPM_CONFIG_LOGLEVEL=error

# node_modules is a named volume (devcontainer.json "mounts"); Docker creates
# it root-owned, and npm as `node` cannot write there until it is handed over.
sudo chown node:node /workspace/node_modules

npm ci

# Playwright's downloader prints a progress line per tick and has no quiet flag.
# Its stdout is only that progress; failures arrive on stderr and still fail the
# script through `set -e`, so drop stdout and announce the step ourselves.
echo "Installing Chromium for Playwright (with system deps)…"
npx playwright install --with-deps chromium > /dev/null
echo "Chromium installed."
