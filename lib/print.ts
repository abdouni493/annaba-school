"use client";

/**
 * Print an HTML document WITHOUT leaving the current page.
 *
 * The whole app previously opened a blank tab (`window.open("", "_blank")`)
 * and wrote the markup there, which meant the print action navigated the user
 * away into a second onglet. Instead we render the markup inside a hidden
 * iframe, invoke the print dialog on that iframe, then discard it — so the user
 * stays on exactly the same tab and interface.
 *
 * The `html` passed in should be a full document string. Any inline
 * `<script>window.print()</script>` is stripped: this helper drives the print
 * dialog itself so it can also clean the iframe up afterwards.
 */
export function printHtmlDocument(html: string, onDone?: () => void): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  // Remove any self-triggering print scripts so we don't double-fire.
  const markup = html.replace(
    /<script>\s*window\.(?:onload\s*=\s*function\s*\(\)\s*\{\s*)?window?\.?print\(\);?\s*\}?;?\s*<\/script>/gi,
    "",
  );

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.visibility = "hidden";
  document.body.appendChild(iframe);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    // Le document est parti à l'imprimante (ou la boîte a été fermée) : c'est
    // le seul moment où l'on peut enchaîner sur le suivant sans empiler deux
    // boîtes de dialogue l'une sur l'autre.
    if (onDone) window.setTimeout(onDone, 0);
    // Small delay so the browser keeps the document alive while the print
    // dialog is being dismissed.
    window.setTimeout(() => iframe.remove(), 500);
  };

  const triggerPrint = () => {
    const win = iframe.contentWindow;
    if (!win) {
      iframe.remove();
      if (onDone) onDone();
      return;
    }
    win.onafterprint = cleanup;
    win.focus();
    win.print();
    // Fallback cleanup in case onafterprint never fires (some browsers).
    window.setTimeout(cleanup, 60000);
  };

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    if (onDone) onDone();
    return;
  }

  doc.open();
  doc.write(markup);
  doc.close();

  // Wait for the iframe (fonts/images/logo) to finish before printing.
  if (doc.readyState === "complete") {
    window.setTimeout(triggerPrint, 60);
  } else {
    iframe.onload = () => window.setTimeout(triggerPrint, 60);
  }
}

/**
 * PLUSIEURS BONS, L'UN APRÈS L'AUTRE.
 *
 * Chaque bon reste un document à part entière — c'est ce qui permet de n'en
 * réimprimer qu'un plus tard. Les lancer tous d'un coup empilerait pourtant N
 * boîtes de dialogue en même temps : le suivant n'est donc envoyé qu'une fois
 * le précédent parti à l'imprimante (ou sa boîte refermée).
 */
export function printHtmlDocuments(documents: string[]): void {
  const queue = documents.filter(Boolean);
  const next = () => {
    const html = queue.shift();
    if (!html) return;
    printHtmlDocument(html, next);
  };
  next();
}
