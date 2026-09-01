#!/usr/bin/env bash
#
# Starts the Kokoro speech backend on the best profile this host supports.
#
#   scripts/start-kokoro.sh           # detect, then start
#   scripts/start-kokoro.sh --gpu     # force the NVIDIA profile
#   scripts/start-kokoro.sh --cpu     # force the CPU profile
#   scripts/start-kokoro.sh --check   # report the detection result, start nothing
#
# Remaining arguments are passed through to `docker compose up`, so
# `scripts/start-kokoro.sh --pull always` works.
#
# The GPU profile needs both a working NVIDIA driver and the NVIDIA Container
# Toolkit. A driver alone is not enough: without the toolkit Docker has no
# `nvidia` runtime and the GPU service fails with `could not select device
# driver`. Detection therefore checks the Docker runtime list, not just the
# presence of a card. Anything that does not satisfy both falls back to the CPU
# profile, which works everywhere, AMD and Intel hosts included.

set -euo pipefail

readonly CPU_CONTAINER="echo-read-kokoro"
readonly GPU_CONTAINER="echo-read-kokoro-gpu"

readonly REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

die() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

compose() {
  docker compose --project-directory "$REPO_ROOT" "$@"
}

# True when the NVIDIA Container Toolkit has registered its runtime with Docker.
# This is what `driver: nvidia` in the compose file actually depends on.
has_nvidia_runtime() {
  docker info --format '{{range $name, $_ := .Runtimes}}{{$name}}{{"\n"}}{{end}}' 2>/dev/null |
    grep -qx 'nvidia'
}

# True when a driver is installed and answering. `nvidia-smi` fails inside
# containers and on hosts where the kernel module is not loaded, which is
# exactly when the GPU profile would start but produce no device.
has_nvidia_driver() {
  command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1
}

# Name of the Kokoro container that already exists, running or stopped. Both
# services publish 8880, so at most one may be present.
existing_container() {
  docker ps --all --format '{{.Names}}' 2>/dev/null |
    grep -x -e "$CPU_CONTAINER" -e "$GPU_CONTAINER" || true
}

detect_profile() {
  if has_nvidia_runtime && has_nvidia_driver; then
    printf 'gpu'
  else
    printf 'cpu'
  fi
}

explain_cpu_fallback() {
  if ! has_nvidia_driver; then
    echo "No usable NVIDIA driver found (nvidia-smi missing or failing)."
  fi
  if ! has_nvidia_runtime; then
    echo "Docker has no 'nvidia' runtime; install the NVIDIA Container Toolkit."
  fi
}

main() {
  local forced="" check_only="false"
  local -a passthrough=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --gpu) forced="gpu"; shift ;;
      --cpu) forced="cpu"; shift ;;
      --check) check_only="true"; shift ;;
      -h|--help) awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "${BASH_SOURCE[0]}"; exit 0 ;;
      *) passthrough+=("$1"); shift ;;
    esac
  done

  command -v docker >/dev/null 2>&1 || die "docker is not installed"
  docker info >/dev/null 2>&1 || die "the Docker daemon is not reachable"
  docker compose version >/dev/null 2>&1 ||
    die "'docker compose' is unavailable; the legacy docker-compose binary is not supported"

  local profile
  if [[ -n "$forced" ]]; then
    profile="$forced"
    echo "Profile: $profile (forced)"
    if [[ "$profile" == "gpu" ]] && ! has_nvidia_runtime; then
      echo "Warning: Docker reports no 'nvidia' runtime, so this will likely fail." >&2
    fi
  else
    profile="$(detect_profile)"
    echo "Profile: $profile (detected)"
    [[ "$profile" == "cpu" ]] && explain_cpu_fallback
  fi

  if [[ "$check_only" == "true" ]]; then
    return 0
  fi

  # `up` does not stop a service the newly selected profile no longer contains,
  # and the two services collide on port 8880, so an old container from the
  # other profile has to go first.
  local target="$CPU_CONTAINER"
  [[ "$profile" == "gpu" ]] && target="$GPU_CONTAINER"

  local existing
  existing="$(existing_container)"
  if [[ -n "$existing" && "$existing" != "$target" ]]; then
    echo "Removing $existing, which belongs to the other profile."
    compose --profile cpu --profile gpu down --remove-orphans
  fi

  # Checked before `up` so the download notice is only shown when there really
  # is one, rather than on every restart of an image that is already local.
  local image cold_start="false"
  image="$(compose --profile "$profile" config --images | head -n 1)"
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    cold_start="true"
  fi

  compose --profile "$profile" up -d "${passthrough[@]}"

  echo
  if [[ "$cold_start" == "true" ]]; then
    echo "Pulling $image: the first run downloads several gigabytes plus the model weights."
  fi
  echo "Kokoro listens on http://127.0.0.1:8880"
  echo "Check readiness with: curl -fsS http://127.0.0.1:8880/health"
}

main "$@"
