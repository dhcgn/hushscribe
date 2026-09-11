#!/usr/bin/env bash
# Runs once when the container is created, before post-create.sh.
# No apt upgrade here: the image is rebuilt upstream, an upgrade made every
# creation slow and non-reproducible, and Playwright's --with-deps runs its own
# apt-get update before installing Chromium's libraries.
set -euo pipefail

# No spinners or progress bars: the output goes to a log, not a terminal.
export CI=true NPM_CONFIG_PROGRESS=false NPM_CONFIG_LOGLEVEL=error

# Docker creates volume mount points — and any missing parent directory — as
# root. Hand them to `node` before anything writes there: npm (node_modules),
# Playwright (~/.cache/ms-playwright), and opencode, whose first run makes
# ~/.cache/opencode. A root-owned ~/.cache made `opencode --version` fail with
# EACCES, and its postinstall silently fell through to the musl builds
# (EBADPLATFORM). The mounts are declared in devcontainer.json.
sudo chown node:node /home/node/.cache /home/node/.cache/ms-playwright /workspace/node_modules

# Update npm within its current major, in the copy the shell actually runs:
# nvm's bin dir precedes the global prefix on PATH, so a plain `npm i -g npm`
# lands in /usr/local/share/npm-global and is shadowed by the bundled one.
npm install -g npm@11 --prefix "$NVM_DIR/current"

# Agent tooling for the container only; not a project dependency.
npm install -g opencode-ai

# `opencode web` spawns xdg-open to show its URL and dies without it. This
# stand-in forwards to VS Code's $BROWSER helper (opens on the host) or prints
# the URL.
sudo install -m 0755 /workspace/.devcontainer/xdg-open /usr/local/bin/xdg-open

# Installing the Agent Package Manager
# https://microsoft.github.io/apm/getting-started/installation/
curl -sSL https://aka.ms/apm-unix | sh
