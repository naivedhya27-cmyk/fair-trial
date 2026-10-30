import type { Metadata } from "next";
import NewTrial from "./NewTrial";

export const metadata: Metadata = { title: "Start a trial" };

export default function Page() {
  return <NewTrial />;
}
