#!/usr/bin/env bash

mkdir -p  ~/.config/opencode/
cp /workspace/.devcontainer/opencode.jsonc  ~/.config/opencode/opencode.jsonc

# Report which secrets opencode.jsonc expects are present. Names only: this
# output lands in the creation log, which gets shared.
while IFS= read -r name; do
    if printenv "$name" > /dev/null 2>&1; then
        printf 'SET     %s\n' "$name"
    else
        printf 'MISSING %s\n' "$name"
    fi
done < <(
    grep -oP '\{env:\K\w+(?=\})' \
        "$HOME/.config/opencode/opencode.jsonc" |
    sort -u
)

# postStartCommand runs on every start: keep the PATH line to one copy.
grep -qxF 'export PATH="$HOME/.local/bin:$PATH"' ~/.bashrc 2>/dev/null ||
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc

curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh

# `rtk init -g` writes ~/.claude/RTK.md and does not create the directory;
# a fresh container has none, and the missing dir failed the whole step.
mkdir -p ~/.claude
export RTK_TELEMETRY_DISABLED=1
"$HOME/.local/bin/rtk" init -g --opencode --auto-patch