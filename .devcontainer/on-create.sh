#!/usr/bin/env bash
# Runs once when the container is created, before post-create.sh.
# The image's `node` user has passwordless sudo; -y keeps apt non-interactive.
set -euo pipefail

# No spinners or progress bars: the output goes to a log, not a terminal.
export CI=true NPM_CONFIG_PROGRESS=false NPM_CONFIG_LOGLEVEL=error

sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y

# The image's npm lags the release that ships with Node; update it first.
npm install -g npm@latest

# Agent tooling for the container only; not a project dependency.
npm install -g opencode-ai
