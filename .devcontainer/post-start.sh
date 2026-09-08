#!/usr/bin/env bash

mkdir -p  ~/.config/opencode/
cp /workspace/.devcontainer/opencode.jsonc  ~/.config/opencode/opencode.jsonc

# Secrets come from .devcontainer/.env, loaded by every interactive shell via
# ~/.bashrc so an edit takes effect in the next terminal, no rebuild needed.
# Loaded here too, so the check below reports the current state (names only).
# A missing one is worth knowing, not worth failing the container start over.
. /workspace/.devcontainer/load-env.sh
bash /workspace/.devcontainer/check-env.sh || true

# postStartCommand runs on every start: keep each ~/.bashrc line to one copy.
add_bashrc_line() {
    grep -qxF "$1" ~/.bashrc 2>/dev/null || echo "$1" >> ~/.bashrc
}
add_bashrc_line 'export PATH="$HOME/.local/bin:$PATH"'
add_bashrc_line '. /workspace/.devcontainer/load-env.sh'

curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh

# `rtk init -g` writes ~/.claude/RTK.md and does not create the directory;
# a fresh container has none, and the missing dir failed the whole step.
mkdir -p ~/.claude
export RTK_TELEMETRY_DISABLED=1
"$HOME/.local/bin/rtk" init -g --opencode --auto-patch