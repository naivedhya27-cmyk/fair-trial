import type { Metadata } from "next";
import JudgeAccess from "./JudgeAccess";

export const metadata: Metadata = { title: "Judge access", robots: { index: false, follow: false } };

export default function Page() {
  return <JudgeAccess />;
}
