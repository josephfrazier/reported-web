import { spawn } from 'child_process';

/**
 * Opens a URL in the default browser, best-effort.
 *
 * Browsersync used to do this for the dev server; this is the small part of
 * it we still want. There is nothing to open in a headless environment (the
 * sandbox, CI), so failures are swallowed: the caller already prints the URL.
 */
export default function openBrowser(url) {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];

  try {
    // Detached, so the dev server isn't tied to the browser's lifetime, and
    // never awaited: whether the page opened is not the server's business.
    spawn(command, args, { stdio: 'ignore', detached: true })
      .on('error', () => {})
      .unref();
  } catch {
    // Same as the error event above: nothing to report.
  }
}
