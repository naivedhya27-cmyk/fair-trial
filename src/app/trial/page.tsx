import type { Metadata } from "next";
import Dashboard from "./Dashboard";

export const metadata: Metadata = { title: "Your trial" };

export default function Page() {
  return <Dashboard />;
}
