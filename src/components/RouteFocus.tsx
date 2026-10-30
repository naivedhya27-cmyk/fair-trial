"use client";
// After a move to another page (S17), focus goes to the new page's heading: a screen reader reads where you are and the
// next Tab starts from the top of the content, not from a link on the page you left. The first page of a visit keeps the
// browser's own start.
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export default function RouteFocus() {
  const path = usePathname();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    // Next keeps pages visited earlier in the document, hidden, for the back button: only a rendered heading counts
    const h1 = [...document.querySelectorAll<HTMLHeadingElement>("main h1")].find((h) => h.getClientRects().length > 0);
    if (!h1) return;
    if (!h1.hasAttribute("tabindex")) h1.tabIndex = -1;
    h1.focus({ preventScroll: true });
  }, [path]);
  return null;
}
