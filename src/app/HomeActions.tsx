"use client";
// The home page's actions (S16): start a trial, or continue the one kept on this phone, and delete everything.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { btn, DeleteEverything } from "@/components/ui";
import { currentTrial } from "@/lib/trial/store";

export default function HomeActions() {
  const [has, setHas] = useState<boolean | null>(null);
  // after "Delete everything", focus goes to the one thing left to do
  const [deleted, setDeleted] = useState(false);
  const start = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (deleted && !has) start.current?.focus();
  }, [deleted, has]);
  useEffect(() => {
    let live = true;
    currentTrial()
      .then((t) => live && setHas(!!t))
      .catch(() => live && setHas(false));
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="flex flex-col gap-3">
      {has ? (
        <Link href="/trial" id="continue-trial" className={btn.primary}>
          Continue your trial
        </Link>
      ) : (
        <Link ref={start} href="/trial/new" id="start-trial" className={btn.primary}>
          Start a trial
        </Link>
      )}
      <Link href="/demo" id="demo-link" className={btn.secondary}>
        Watch a demo trial in a minute
      </Link>
      <Link href="/capture" id="camera-check" className={btn.secondary}>
        Try the camera first
      </Link>
      {has && (
        <DeleteEverything
          onDone={() => {
            setHas(false);
            setDeleted(true);
          }}
        />
      )}
    </div>
  );
}
