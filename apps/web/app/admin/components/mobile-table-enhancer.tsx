"use client";

import { useEffect } from "react";

function isDialogTable(table: HTMLTableElement) {
  return Boolean(
    table.closest(
      '[role="dialog"], [data-mobile-table-mode="scroll"], .modal-body, .form-modal, .config-modal, .admin-confirm-dialog, .fixed',
    ),
  );
}

function enhanceTables(root: HTMLElement) {
  const tables = Array.from(root.querySelectorAll<HTMLTableElement>("table"));

  for (const table of tables) {
    if (isDialogTable(table)) {
      continue;
    }

    const firstHeaderRow = table.tHead?.rows[0];
    const headerCells: string[] = firstHeaderRow
      ? Array.from(firstHeaderRow.cells).map(
          (cell: HTMLTableCellElement) =>
            cell.textContent?.replace(/\s+/g, " ").trim() ?? "",
        )
      : [];

    if (headerCells.length === 0) {
      continue;
    }

    if (!table.classList.contains("admin-mobile-card-table")) {
      table.classList.add("admin-mobile-card-table");
    }
    const wrapper = table.parentElement;
    if (wrapper && !wrapper.classList.contains("admin-mobile-card-table-wrap")) {
      wrapper.classList.add("admin-mobile-card-table-wrap");
    }

    for (const body of Array.from(table.tBodies)) {
      for (const row of Array.from(body.rows)) {
        const cells = Array.from(row.cells);
        cells.forEach((cell: HTMLTableCellElement, index: number) => {
          if (cell.colSpan > 1 || cell.hasAttribute("data-mobile-label-skip")) {
            return;
          }

          const label = headerCells[index];
          if (label && cell.dataset.label !== label) {
            cell.dataset.label = label;
          }
        });
      }
    }
  }
}

export function MobileTableEnhancer() {
  useEffect(() => {
    const root = document.getElementById("admin-main-scroll");
    if (!root) {
      return;
    }

    enhanceTables(root);
    const observer = new MutationObserver(() => enhanceTables(root));
    observer.observe(root, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  return null;
}
