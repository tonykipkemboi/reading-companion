// Runs in a hidden, sandboxed window with no network access. It is handed the bytes of a
// PDF, reads the text out with pdf.js and hands the text back. PDFs come from the open
// web, so they are parsed here and never in the app's background process.
import * as pdfjs from '../../node_modules/pdfjs-dist/build/pdf.min.mjs';

const lib = (file) => new URL(`../../node_modules/pdfjs-dist/${file}`, import.meta.url).href;
pdfjs.GlobalWorkerOptions.workerSrc = lib('build/pdf.worker.min.mjs');

const tidy = (text) => text.replace(/[ \t ]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

async function read({ data, limit }) {
  const doc = await pdfjs.getDocument({
    data,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    cMapUrl: lib('cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: lib('standard_fonts/'),
    verbosity: 0,
  }).promise;

  let title = '';
  try {
    const meta = await doc.getMetadata();
    title = String(meta?.info?.Title || '').trim();
  } catch { /* a PDF without metadata is fine */ }

  let text = '';
  let pagesRead = 0;
  for (let n = 1; n <= doc.numPages && text.length < limit; n += 1) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    let pageText = '';
    for (const item of content.items) {
      if (typeof item.str !== 'string') continue;
      pageText += item.str + (item.hasEOL ? '\n' : '');
    }
    text += `${tidy(pageText)}\n\n`;
    pagesRead = n;
    page.cleanup();
  }
  // The window is thrown away after one PDF, so nothing needs releasing here.
  return { ok: true, text: tidy(text).slice(0, limit), title: title.slice(0, 300), pages: doc.numPages, pagesRead };
}

window.pdfHost.onJob(async (job) => {
  try {
    window.pdfHost.done(await read(job));
  } catch (err) {
    console.error('PDF text could not be read:', err?.name, err?.message);
    window.pdfHost.done({ ok: false, reason: err?.name === 'PasswordException' ? 'locked' : 'unreadable' });
  }
});
window.pdfHost.ready();
