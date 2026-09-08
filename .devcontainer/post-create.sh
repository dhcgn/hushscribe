#!/usr/bin/env bash
# Runs after the container is created: project dependencies and the browser
# the e2e suite drives. `--with-deps` installs Chromium's system libraries
# through the same passwordless sudo.
set -euo pipefail

# No spinners or progress bars: the output goes to a log, not a terminal.
export CI=true NPM_CONFIG_PROGRESS=false NPM_CONFIG_LOGLEVEL=error

# node_modules and the Playwright browser cache are named volumes
# (devcontainer.json "mounts"), handed to `node` by on-create.sh before this runs.
npm ci

# Playwright's downloader prints a progress line per tick and has no quiet flag.
# Its stdout is only that progress; failures arrive on stderr and still fail the
# script through `set -e`, so drop stdout and announce the step ourselves.
# With the cache volume populated this only installs the system libraries.
echo "Installing Chromium for Playwright (with system deps)…"
npx playwright install --with-deps chromium > /dev/null
echo "Chromium installed."
