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

# `opencode web` spawns xdg-open to show its URL and dies without it. This
# stand-in forwards to VS Code's $BROWSER helper (opens on the host) or prints
# the URL.
sudo install -m 0755 /workspace/.devcontainer/xdg-open /usr/local/bin/xdg-open
