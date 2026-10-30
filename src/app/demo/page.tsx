import type { Metadata } from "next";
import DemoTrial from "./DemoTrial";

export const metadata: Metadata = { title: "Demo trial" };

export default function Page() {
  return <DemoTrial />;
}
