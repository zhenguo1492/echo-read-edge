import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { access, cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

interface RuntimeError {
  code: string
  message: string
}

type CommandResult =
  | {
      ok: true
      playbackId: string
      state: string
      wordBoundaries?: Array<{
        word: string
        startTime: number
        endTime: number
      }>
    }
  | {
      ok: false
      error: RuntimeError
    }

interface PlaybackFlow {
  start: CommandResult
  pause?: CommandResult
  resume?: CommandResult
  stop?: CommandResult
}

interface DnrDebugMatch {
  ruleId: number
  rulesetId: string
  requestUrl: string
  resourceType: string
  initiator?: string
  tabId: number
}

interface DnrMatchedRule {
  ruleId: number
  rulesetId: string
  tabId: number
  timeStamp: number
}

interface NetworkDebugRequest {
  requestUrl: string
  resourceType: string
  initiator?: string
  tabId: number
  timeStamp: number
}

interface LiveVerificationReport {
  request: {
    text: string
    voice: string
    rate: number
  }
  initialFlow: PlaybackFlow
  recreatedFlow: PlaybackFlow
  offscreenContextCounts: {
    beforeClose: number
    afterClose: number
    afterRecreation: number
  }
  dnrMatches: DnrDebugMatch[]
  matchedRules: DnrMatchedRule[]
  observedRequests: NetworkDebugRequest[]
  extensionId: string
  chromeUserAgent: string
  chromePath: string
}

interface WorkerHandle {
  url(): string
  evaluate<T>(expression: () => Promise<T>): Promise<T>
}

interface PageHandle {
  goto(url: string): Promise<unknown>
  textContent(selector: string): Promise<string | null>
  waitForFunction(expression: () => boolean, options: { timeout: number }): Promise<unknown>
  evaluate<T>(expression: () => Promise<T>): Promise<T>
}

interface BrowserContextHandle {
  serviceWorkers(): WorkerHandle[]
  waitForEvent(event: 'serviceworker', options: { timeout: number }): Promise<WorkerHandle>
  newPage(): Promise<PageHandle>
  close(): Promise<void>
}

interface ChromiumHandle {
  launchPersistentContext(
    userDataDir: string,
    options: {
      headless: boolean
      executablePath: string
      ignoreDefaultArgs: string[]
      args: string[]
    }
  ): Promise<BrowserContextHandle>
}

const require = createRequire(import.meta.url)
const projectRoot = resolve(process.cwd())
const verificationText =
  'Hello from EchoRead Edge. This sentence verifies production audio playback controls.'

/**
 * Exercises the production public-message, service-worker, offscreen-document,
 * Provider, and audio playback chain in a disposable real Chrome profile.
 */
async function main(): Promise<void> {
  const chromium = loadChromium()
  const chromePath = await findChromeExecutable()
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'echo-read-edge-live-'))
  const extensionPath = join(temporaryRoot, 'extension')
  const profilePath = join(temporaryRoot, 'profile')
  let context: BrowserContextHandle | undefined

  try {
    buildExtension()
    await cp(join(projectRoot, 'output'), extensionPath, { recursive: true })
    await enableTemporaryDiagnostics(extensionPath)
    await createVerificationAssets(extensionPath, temporaryRoot)

    context = await chromium.launchPersistentContext(profilePath, {
      headless: true,
      executablePath: chromePath,
      // Playwright disables extensions by default; retaining that argument would
      // prevent the production service worker and DNR rules from loading.
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    })

    let workers = context.serviceWorkers()
    if (workers.length === 0) {
      workers = [await context.waitForEvent('serviceworker', { timeout: 10_000 })]
    }

    const worker = workers[0]
    const extensionId = new URL(worker.url()).host
    const page = await context.newPage()
    await page.goto(`chrome-extension://${extensionId}/verify-edge-tts.html`)
    await page.waitForFunction(
      () => document.body.dataset.complete === 'true',
      { timeout: 30_000 }
    )

    const serializedInitialFlow = await page.textContent('body')
    if (!serializedInitialFlow) {
      throw new Error('The production verification page returned no result.')
    }
    const initialFlow = JSON.parse(serializedInitialFlow) as PlaybackFlow

    const beforeClose = await getOffscreenContextCount(worker)
    await worker.evaluate(async () => {
      const closeDocument = (
        globalThis as typeof globalThis & {
          closeVerificationOffscreen?: () => Promise<void>
        }
      ).closeVerificationOffscreen
      if (!closeDocument) throw new Error('The offscreen close verifier was not registered.')
      await closeDocument()
    })
    const afterClose = await getOffscreenContextCount(worker)

    // The same extension page starts a second public flow after forced closure.
    // Success proves the production background rechecked and rebuilt the document.
    const recreatedFlow = await page.evaluate(async () => {
      const runFlow = (
        globalThis as typeof globalThis & {
          runEdgeTtsProductionFlow?: () => Promise<PlaybackFlow>
        }
      ).runEdgeTtsProductionFlow
      if (!runFlow) throw new Error('The production flow verifier was not registered.')
      return runFlow()
    })
    const afterRecreation = await getOffscreenContextCount(worker)

    const workerDiagnostics = await worker.evaluate(async () => {
      const scope = globalThis as typeof globalThis & {
        getEdgeTtsDnrMatches?: () => DnrDebugMatch[]
        getEdgeTtsNetworkRequests?: () => NetworkDebugRequest[]
      }
      const matchedRules = await chrome.declarativeNetRequest.getMatchedRules({
        minTimeStamp: Date.now() - 60_000
      })
      return {
        dnrMatches: scope.getEdgeTtsDnrMatches?.() ?? [],
        matchedRules: matchedRules.rulesMatchedInfo.map((match) => ({
          ruleId: match.rule.ruleId,
          rulesetId: match.rule.rulesetId,
          tabId: match.tabId,
          timeStamp: match.timeStamp
        })),
        observedRequests: scope.getEdgeTtsNetworkRequests?.() ?? [],
        userAgent: navigator.userAgent
      }
    })

    const report: LiveVerificationReport = {
      request: {
        text: verificationText,
        voice: 'en-US-AriaNeural',
        rate: 1
      },
      initialFlow,
      recreatedFlow,
      offscreenContextCounts: {
        beforeClose,
        afterClose,
        afterRecreation
      },
      dnrMatches: workerDiagnostics.dnrMatches,
      matchedRules: workerDiagnostics.matchedRules,
      observedRequests: workerDiagnostics.observedRequests,
      extensionId,
      chromeUserAgent: workerDiagnostics.userAgent,
      chromePath
    }

    console.log(JSON.stringify(report, null, 2))
    validateRuntimeResults(report)
  } finally {
    await context?.close()
    await rm(temporaryRoot, { force: true, recursive: true })
  }
}

/** Loads Playwright Core without adding it to the shipped extension runtime. */
function loadChromium(): ChromiumHandle {
  const moduleName = process.env.PLAYWRIGHT_CORE_PATH ?? 'playwright-core'
  try {
    const loaded = require(moduleName) as { chromium?: ChromiumHandle }
    if (!loaded.chromium) throw new Error('The module does not export Chromium.')
    return loaded.chromium
  } catch (error) {
    throw new Error(
      'Playwright Core is required for live Edge TTS verification. Install it as a development dependency or expose it through PLAYWRIGHT_CORE_PATH.',
      { cause: error }
    )
  }
}

/** Selects an explicit Chrome first, then a local Playwright or system build. */
async function findChromeExecutable(): Promise<string> {
  const candidates: string[] = []
  if (process.env.CHROME_PATH) candidates.push(process.env.CHROME_PATH)

  const playwrightCache = join(homedir(), '.cache', 'ms-playwright')
  try {
    const directories = (await readdir(playwrightCache))
      .filter((entry) => entry.startsWith('chromium-'))
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))

    for (const directory of directories) {
      candidates.push(
        join(playwrightCache, directory, 'chrome-linux64', 'chrome'),
        join(playwrightCache, directory, 'chrome-linux', 'chrome')
      )
    }
  } catch {
    // The cache is optional; system Chrome candidates are checked below.
  }

  candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser')
  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // Continue until an executable candidate is found.
    }
  }

  throw new Error('No Linux Chrome or Chromium executable was found.')
}

/** Builds the same main and single-file content bundles used by the extension. */
function buildExtension(): void {
  runLocalBinary('vite', ['build'])
  runLocalBinary('vite', ['build'], { BUILD_TARGET: 'content' })
}

function runLocalBinary(
  name: string,
  args: string[],
  environment: Record<string, string> = {}
): void {
  const binary = join(projectRoot, 'node_modules', '.bin', name)
  const completed = spawnSync(binary, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, ...environment }
  })

  if (completed.status !== 0) {
    throw new Error(`${name} failed.\n${completed.stdout ?? ''}${completed.stderr ?? ''}`)
  }
}

/** Adds diagnostics only to the disposable extension copy used by this test. */
async function enableTemporaryDiagnostics(extensionPath: string): Promise<void> {
  const manifestPath = join(extensionPath, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    permissions: string[]
  }
  for (const permission of ['declarativeNetRequestFeedback', 'webRequest']) {
    if (!manifest.permissions.includes(permission)) manifest.permissions.push(permission)
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

/**
 * Adds a disposable extension page that uses only the public TTS contract and a
 * diagnostic worker entry that imports the unchanged production background.
 */
async function createVerificationAssets(
  extensionPath: string,
  temporaryRoot: string
): Promise<void> {
  const backgroundPath = join(projectRoot, 'src', 'background', 'index.ts')
  const pageEntryPath = join(temporaryRoot, 'verify-edge-tts-page-entry.ts')
  const pageEntrySource = `
interface CommandResult {
  ok: boolean
  playbackId?: string
  state?: string
  wordBoundaries?: Array<{ word: string; startTime: number; endTime: number }>
  error?: { code: string; message: string }
}

interface PlaybackFlow {
  start: CommandResult
  pause?: CommandResult
  resume?: CommandResult
  stop?: CommandResult
}

async function runEdgeTtsProductionFlow(): Promise<PlaybackFlow> {
  const start = await chrome.runtime.sendMessage({
    action: 'tts:start',
    text: ${JSON.stringify(verificationText)},
    voice: 'en-US-AriaNeural',
    rate: 1
  }) as CommandResult
  const flow: PlaybackFlow = { start }
  if (!start.ok || !start.playbackId) return flow

  flow.pause = await chrome.runtime.sendMessage({
    action: 'tts:pause',
    playbackId: start.playbackId
  }) as CommandResult
  flow.resume = await chrome.runtime.sendMessage({
    action: 'tts:resume',
    playbackId: start.playbackId
  }) as CommandResult
  flow.stop = await chrome.runtime.sendMessage({
    action: 'tts:stop',
    playbackId: start.playbackId
  }) as CommandResult
  return flow
}

Object.assign(globalThis, { runEdgeTtsProductionFlow })

try {
  document.body.textContent = JSON.stringify(await runEdgeTtsProductionFlow())
} catch (error) {
  document.body.textContent = JSON.stringify({
    start: {
      ok: false,
      error: {
        code: 'verification-page-failed',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })
} finally {
  document.body.dataset.complete = 'true'
}
`

  await writeFile(pageEntryPath, pageEntrySource)
  runLocalBinary('esbuild', [
    pageEntryPath,
    '--bundle',
    '--platform=browser',
    '--format=esm',
    `--outfile=${join(extensionPath, 'verify-edge-tts.js')}`
  ])
  await writeFile(
    join(extensionPath, 'verify-edge-tts.html'),
    '<!doctype html><html lang="en"><body>pending<script type="module" src="verify-edge-tts.js"></script></body></html>\n'
  )

  const workerEntryPath = join(temporaryRoot, 'verify-edge-tts-worker-entry.ts')
  const workerEntrySource = `
import ${JSON.stringify(backgroundPath)}

interface DnrDebugMatch {
  ruleId: number
  rulesetId: string
  requestUrl: string
  resourceType: string
  initiator?: string
  tabId: number
}

interface NetworkDebugRequest {
  requestUrl: string
  resourceType: string
  initiator?: string
  tabId: number
  timeStamp: number
}

const dnrMatches: DnrDebugMatch[] = []
const networkRequests: NetworkDebugRequest[] = []

chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((details) => {
  dnrMatches.push({
    ruleId: details.rule.ruleId,
    rulesetId: details.rule.rulesetId,
    requestUrl: details.request.url,
    resourceType: details.request.type,
    initiator: details.request.initiator,
    tabId: details.request.tabId
  })
})

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    networkRequests.push({
      requestUrl: details.url,
      resourceType: details.type,
      initiator: details.initiator,
      tabId: details.tabId,
      timeStamp: details.timeStamp
    })
  },
  { urls: ['wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1*'] }
)

Object.assign(globalThis, {
  closeVerificationOffscreen: (): Promise<void> => chrome.offscreen.closeDocument(),
  getEdgeTtsDnrMatches: (): DnrDebugMatch[] => [...dnrMatches],
  getEdgeTtsNetworkRequests: (): NetworkDebugRequest[] => [...networkRequests]
})
`

  await writeFile(workerEntryPath, workerEntrySource)
  runLocalBinary('esbuild', [
    workerEntryPath,
    '--bundle',
    '--platform=browser',
    '--format=esm',
    `--outfile=${join(extensionPath, 'background.js')}`
  ])
}

/** Reads the production offscreen context count through the service worker. */
function getOffscreenContextCount(worker: WorkerHandle): Promise<number> {
  return worker.evaluate(async () => {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [chrome.runtime.getURL('/offscreen.html')]
    })
    return contexts.length
  })
}

/** Requires two complete flows, a real rebuild, and two DNR-observed sockets. */
function validateRuntimeResults(report: LiveVerificationReport): void {
  validatePlaybackFlow(report.initialFlow, 'initial production flow')
  validatePlaybackFlow(report.recreatedFlow, 'recreated production flow')

  const initialStart = requireSuccess(report.initialFlow.start, 'initial start')
  const recreatedStart = requireSuccess(report.recreatedFlow.start, 'recreated start')
  if (initialStart.playbackId === recreatedStart.playbackId) {
    throw new Error('The recreated flow reused the previous playback ID.')
  }

  const counts = report.offscreenContextCounts
  if (counts.beforeClose !== 1 || counts.afterClose !== 0 || counts.afterRecreation !== 1) {
    throw new Error(
      `Unexpected offscreen lifecycle counts: ${counts.beforeClose}, ${counts.afterClose}, ${counts.afterRecreation}.`
    )
  }

  const edgeMatches = report.matchedRules.filter((match) => match.ruleId === 1)
  if (edgeMatches.length < 2) {
    throw new Error(`Expected at least two Edge DNR matches, received ${edgeMatches.length}.`)
  }
  if (report.observedRequests.length < 2) {
    throw new Error(
      `Expected at least two observed Edge WebSockets, received ${report.observedRequests.length}.`
    )
  }
}

function validatePlaybackFlow(flow: PlaybackFlow, label: string): void {
  const start = requireSuccess(flow.start, `${label} start`)
  if (start.state !== 'playing') {
    throw new Error(`${label} did not enter the playing state.`)
  }
  if (!Array.isArray(start.wordBoundaries) || start.wordBoundaries.length === 0) {
    throw new Error(`${label} returned no WordBoundary metadata.`)
  }
  for (const boundary of start.wordBoundaries) {
    if (
      typeof boundary.word !== 'string' ||
      !Number.isFinite(boundary.startTime) ||
      !Number.isFinite(boundary.endTime)
    ) {
      throw new Error(`${label} returned a malformed WordBoundary.`)
    }
  }

  validateControl(flow.pause, start.playbackId, 'paused', `${label} pause`)
  validateControl(flow.resume, start.playbackId, 'playing', `${label} resume`)
  validateControl(flow.stop, start.playbackId, 'stopped', `${label} stop`)
}

function validateControl(
  result: CommandResult | undefined,
  playbackId: string,
  expectedState: string,
  label: string
): void {
  if (!result) throw new Error(`${label} returned no response.`)
  const success = requireSuccess(result, label)
  if (success.playbackId !== playbackId || success.state !== expectedState) {
    throw new Error(`${label} returned an unexpected playback ID or state.`)
  }
}

function requireSuccess(
  result: CommandResult,
  label: string
): Extract<CommandResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(`${label} failed: ${result.error.code}: ${result.error.message}`)
  }
  return result
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
