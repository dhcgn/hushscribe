# Source this, don't run it:  . /workspace/.devcontainer/load-env.sh
#
# Exports every KEY=value line of .devcontainer/.env (gitignored) into the
# current shell. The file sits on the bind mount, so an edit on the host is
# live in the container: open a new terminal, or `source ~/.bashrc`, and the
# new values are there — no rebuild. Absent file: nothing happens.
#
# Wired in three places: ~/.bashrc (interactive terminals, by post-start.sh),
# post-start.sh itself (so check-env.sh reports the current state), and the
# OpenCode tasks in .vscode/tasks.json (a task's `bash -c` reads no .bashrc).
if [ -f /workspace/.devcontainer/.env ]; then
  set -a
  . /workspace/.devcontainer/.env
  set +a
fi
