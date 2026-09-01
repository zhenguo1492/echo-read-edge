# Speech in EchoRead Edge

This is the page behind the *Help* button in the popup's speech-engine
settings. It explains what produces the voice you hear, which of the two
engines to pick, and — for the local one — how to get it running on your
machine from nothing.

Nothing here assumes you have the extension's source code. Every command below
can be run in an empty directory.

## What text-to-speech does here

Text-to-speech, or TTS, turns written text into spoken audio. A TTS engine
takes a sentence and returns a sound file, the way a translator returns a
sentence in another language.

EchoRead Edge does not synthesize anything itself. It finds the readable text
on the page, splits it into sentences, and sends them one at a time to whichever
engine you selected. The engine returns two things: the audio, and a list of
word timings saying when each word begins. The audio is what you hear; the
timings are what lets the extension highlight the word being spoken as it moves
through the sentence.

That is why the choice of engine matters beyond voice quality. It decides where
your text is processed — on your own machine, or on a company's servers — and
whether reading works with no network at all.

## The two engines

Both are selectable in the popup under *Settings > Speech engine*, and they
trade setup effort against everything else.

| | Kokoro (default) | Edge Read Aloud |
| --- | --- | --- |
| Runs | On your machine, in Docker | On Microsoft's servers |
| Setup | Install Docker, start one container | None |
| Privacy | Text never leaves the host | Every sentence is sent to Microsoft |
| Works offline | Yes | No |
| Suitable for | Everyday use | Trying the extension out, or a broken local server |

**Edge Read Aloud** is the speech service behind Microsoft Edge's *Read Aloud*
feature. It needs no setup whatsoever, so it is what to select in the first
minute — the extension works before you have installed anything. The cost is
that every sentence you read is sent to Microsoft, and that the endpoint is not
a public API: Microsoft does not document or support third-party use of it and
can change or block it at any time. Treat it as the way to try things out, not
as the engine you leave selected.

**Kokoro** is the local engine and the default. It runs on your own machine, so
your text stays there and reading keeps working with the network off. The cost
is a one-time setup: a Docker install and a multi-gigabyte image. The rest of
this page is that setup.

## Kokoro runs in Docker

[Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) is an 82M-parameter
open-weights TTS model. What you actually run is
[Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI), a small HTTP server
wrapping that model; the extension calls its captioned-speech route, which
returns word timings alongside the MP3.

It is distributed as a Docker image, and that is the sensible way to run it: the
image already contains the right Python, the right PyTorch, and the model
weights, so there is no dependency work on your side. Docker is a program that
runs such a packaged image in an isolated container on your machine — a local
program, not a cloud service, despite the "container" vocabulary.

There are two images, and they differ only in what does the computing:

| | CPU image | GPU image |
| --- | --- | --- |
| Runs on | Any machine | NVIDIA cards only |
| Also needs | Nothing | NVIDIA driver plus the NVIDIA Container Toolkit |
| Download | Roughly 5 GB | Roughly 13 GB |
| Speed | Faster than real time on a modern multi-core CPU | Several times faster again |
| Available on | Linux, Windows, macOS | Linux with Docker Engine, and Windows with the WSL2 backend |

**Start with the CPU image.** An 82M-parameter model is small, and the CPU
version already synthesizes faster than you can listen: after the first
sentence, playback stays ahead of the reading. The GPU version mostly shortens
the wait before the first sentence. It is also the larger download, and it is
unavailable on macOS and on any machine without an NVIDIA card — see
[GPU details](#gpu-details) if you have one and want it.

Both listen on `127.0.0.1:8880`, the address the extension ships as its default,
and exactly one of them can run at a time because they share that port. The
address is bound to your own machine, so nothing on the network can reach it.

## Installing Docker

Two pieces are needed: the Docker Engine itself and the Compose v2 plugin,
which is what the `docker compose` command is. The older `docker-compose`
binary is a separate, unsupported program.

**Linux.** Install from Docker's own repository rather than the distribution's
package, which is usually older and often ships without the Compose plugin. The
convenience script does both:

```sh
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker
```

Then let your user reach Docker without `sudo`. Group membership only applies to
new logins, which is what `newgrp` stands in for here:

```sh
sudo usermod -aG docker "$USER"
newgrp docker
```

The per-distribution instructions, for anyone who would rather not pipe a script
into a shell, are at
[docs.docker.com/engine/install](https://docs.docker.com/engine/install/).

**Windows.** Install [Docker
Desktop](https://docs.docker.com/desktop/setup/install/windows-install/) and
leave the WSL2 backend selected under *Settings > General*. Run `wsl --install`
first if WSL2 is not on the machine yet. WSL2 is also the only backend that can
reach an NVIDIA card, so the choice matters beyond installation.

**macOS.** Install [Docker
Desktop](https://docs.docker.com/desktop/setup/install/mac-install/) and pick
the build matching the chip, Apple Silicon or Intel. Only the CPU image runs on
a Mac; on Apple Silicon it runs natively rather than under emulation.

Verify before continuing. All three commands must succeed:

```sh
docker --version
docker compose version     # must report v2.x
docker run --rm hello-world
```

## Setting up the Kokoro container

### The two files

Create a directory anywhere — `kokoro/` in your home directory is fine — and put
these two files in it.

`docker-compose.yml` describes both services. Copy it verbatim:

```yaml
name: echo-read-edge

services:
  kokoro:
    image: ghcr.io/remsky/kokoro-fastapi-cpu:latest
    container_name: echo-read-kokoro
    profiles: ["cpu"]
    ports:
      - "127.0.0.1:8880:8880"
    environment:
      # The extension only calls the synthesis and voice endpoints.
      ENABLE_WEB_PLAYER: "false"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8880/health')"]
      interval: 30s
      timeout: 5s
      start_period: 90s
      retries: 3

  kokoro-gpu:
    image: ghcr.io/remsky/kokoro-fastapi-gpu:latest
    container_name: echo-read-kokoro-gpu
    profiles: ["gpu"]
    ports:
      - "127.0.0.1:8880:8880"
    environment:
      ENABLE_WEB_PLAYER: "false"
    restart: unless-stopped
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8880/health')"]
      interval: 30s
      timeout: 5s
      start_period: 90s
      retries: 3
```

`.env`, in the same directory, one line long:

```sh
COMPOSE_PROFILES=cpu
```

That line is what makes a bare `docker compose up -d` start the CPU service.
Both services carry a profile, and Compose starts nothing when no profile is
selected; a `--profile gpu` flag on the command line replaces this value.

### Step by step

1. **Install Docker** as described above, and confirm `docker compose version`
   reports v2.
2. **Open a terminal in the directory holding those two files.**
3. **Start the server.** The CPU service, which is what almost everyone wants:

```sh
docker compose up -d
```

On an NVIDIA host set up for the GPU profile, use this instead:

```sh
docker compose --profile gpu up -d
```

4. **Wait out the first download.** The image is roughly 5 GB for CPU and 13 GB
   for GPU, and the model weights are fetched on the first start on top of that,
   so the first run takes minutes rather than seconds. Watch it:

```sh
docker compose logs -f kokoro    # kokoro-gpu for the GPU profile
```

The server is ready when the log shows Uvicorn listening on port 8880. `Ctrl+C`
leaves the log; it does not stop the container.

5. **Check that it answers**, both the health route and the voice route the
   extension calls:

```sh
curl -fsS http://127.0.0.1:8880/health
curl -fsS http://127.0.0.1:8880/v1/audio/voices | head -c 200
```

6. **Point the extension at it.** Open the popup, go to *Settings*, select
   *Kokoro* as the speech engine, and leave the address at
   `http://127.0.0.1:8880` unless you moved it. Click the indicator beside the
   address to probe the server; a green mark means the extension reached a real
   Kokoro API. When no server answers, the popup falls back to its built-in
   voice list and playback reports a connection error rather than silently
   switching engines.
7. **Read a page** to confirm end to end: open any article and press play. The
   first sentence takes a moment while the model warms up, after which synthesis
   stays ahead of playback.

### Everyday commands

Run these in the same directory:

```sh
docker compose ps                       # what is running
docker compose logs -f kokoro           # follow the log
docker compose stop                     # stop, keep the container
docker compose start                    # start it again
docker compose down                     # remove the container
docker compose pull && docker compose up -d   # update to a newer image
```

The container carries `restart: unless-stopped`, so it comes back on its own
after a reboot until you stop it explicitly. Switching between the CPU and GPU
profiles needs `docker compose down` first, because `up` does not stop a service
the newly selected profile no longer contains, and the two collide on port 8880.

## When something does not work

- **`permission denied` on `/var/run/docker.sock`.** Your user is not in the
  `docker` group yet, or the shell predates the change. Log out and back in.
- **`port is already allocated` on 8880.** Something else holds the port, most
  often the other profile's container. `docker compose ps --all` finds it, and
  `docker compose down` clears it.
- **`could not select device driver "nvidia"`.** The GPU profile started without
  the NVIDIA Container Toolkit. Install it as described below, or run the CPU
  profile.
- **The container restarts in a loop.** `docker compose logs kokoro` names the
  reason; out-of-memory during model load is the common one on small hosts, and
  the CPU image wants roughly 4 GB available to Docker.
- **`curl` succeeds but the popup marks the server unusable.** Check the address
  in *Settings* for a trailing path or an `https://` scheme; the extension talks
  plain HTTP to the host and port only.
- **Reading stops with a connection error.** The container was stopped or is
  still warming up. `docker compose ps` shows its state; switch to Edge Read
  Aloud in the popup meanwhile.

## GPU details

Everything in this section is optional. The CPU profile needs none of it.

### Platform support

The CPU image runs on every host below. The GPU image is NVIDIA-only and, on top
of that, only reachable on two of them.

| Host | GPU image | Why |
| --- | --- | --- |
| Linux + Docker Engine, NVIDIA card | Yes | Driver plus NVIDIA Container Toolkit; see below |
| Linux + Docker Engine, AMD / Intel / no card | No | Image is built against CUDA; no ROCm variant exists |
| Linux + Docker Desktop | No | Containers run in a VM with no host GPU access; use Docker Engine directly |
| Windows + Docker Desktop, WSL2 backend, NVIDIA card | Yes | The only supported path on Windows |
| Windows + Docker Desktop, Hyper-V backend | No | GPU paravirtualization exists only in the WSL2 VM |
| Windows, native Windows containers | N/A | Windows base images only; Kokoro's image is Linux |
| macOS, Apple Silicon | No | The VM never gets host GPU access; the CPU image runs natively |
| macOS, Intel | No | Same VM limit, and no NVIDIA driver since macOS 10.14 |

### Enabling the GPU profile on an NVIDIA host

The GPU profile needs two separate pieces. A working host driver is not enough
on its own: without the container toolkit Docker has no `nvidia` runtime and the
service fails with `could not select device driver "nvidia" with capabilities:
[[gpu]]`.

1. **The NVIDIA driver.** Install it through the distribution's package manager.
   `nvidia-smi` must print your card before continuing.
2. **The NVIDIA Container Toolkit.** This is what registers the `nvidia` runtime
   with Docker so a container can reach the card.

Add the repository and install, on Debian, Ubuntu, and Mint:

```sh
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
  | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
  | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
  | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
```

Or on RHEL, CentOS, and Fedora:

```sh
curl -s -L https://nvidia.github.io/libnvidia-container/stable/rpm/nvidia-container-toolkit.repo \
  | sudo tee /etc/yum.repos.d/nvidia-container-toolkit.repo

sudo dnf install -y nvidia-container-toolkit
```

Then point Docker at the runtime and restart the daemon, on either family:

```sh
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

Verify before starting Kokoro. This must list `nvidia`:

```sh
docker info | grep Runtimes
```

The commands above track the [official install
guide](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html),
which also documents how to pin an exact toolkit version. They are for a Linux
host running Docker Engine directly.

### Hosts without an NVIDIA GPU

AMD, Intel, and machines with no discrete GPU run the CPU image, and that is the
whole story: there is no GPU acceleration available to them here. Kokoro itself
is ordinary PyTorch with no CUDA-only operators, but the upstream image is built
against CUDA and ships no ROCm variant, so there is nothing else to select.
Installing the NVIDIA toolkit on such a host does not help either — it registers
a runtime that finds no card.

This matters less than it sounds, because the CPU image already keeps ahead of
playback and is the smaller download of the two.

### macOS and Windows

Docker Desktop states that GPU support is only available on Windows with the
WSL2 backend. That sentence is about Docker Desktop specifically; native Docker
Engine on Linux reaches the card directly.

**Windows, with an NVIDIA card.** Three things, none of them the toolkit
described above:

1. An NVIDIA Windows driver supporting WSL2 GPU paravirtualization. It goes on
   the Windows side, not inside the Linux distribution.
2. An up-to-date WSL2 kernel: `wsl --update`.
3. Docker Desktop with the WSL2 backend enabled, under *Settings > General*.

WSL2 is not optional for this. Linux containers on Windows always run inside a
VM, and NVIDIA's GPU paravirtualization exists only in the WSL2 one, so the
Hyper-V backend has no path to the card at all. Do not install a Linux NVIDIA
driver inside the WSL distribution: it overwrites the paravirtualized libraries
Windows injects and breaks GPU access from containers.

**macOS.** There is no GPU profile on any Mac, and nothing can be installed to
create one. Containers run inside a Linux VM that is never given access to the
host GPU, so neither Apple Silicon's integrated GPU nor a discrete card is
reachable. Use the CPU image; on Apple Silicon it runs natively from the image's
`linux/arm64` variant rather than under emulation.

## More about Edge Read Aloud

"Edge TTS" is the speech service behind Microsoft Edge's *Read Aloud* feature.
It is the same neural voice catalog Azure Speech sells, reached over a WebSocket
at `speech.platform.bing.com` that the browser's own Read Aloud UI uses without
an API key. The extension speaks that protocol directly: it opens the socket in
its service worker, sends the sentence, and receives audio plus word-boundary
events — the same timings the highlight needs.

Select it under *Speech engine* in the popup. It needs no setup at all, which is
the point: it is there so the extension works before you have pulled a 5 GB
image, and when your local server is down.

Use it in moderation. This endpoint is not a public API — Microsoft does not
document or support third-party use of it, applies no key and therefore no
quota, and can change or block it at any time. Every sentence you read is sent
to Microsoft, so nothing you would not paste into a Microsoft product should go
through it.

When Edge is unavailable, the popup falls back to the built-in voice list, the
handshake failure is reported instead of retried forever, and reading stops
rather than looping.
