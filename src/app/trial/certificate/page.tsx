import type { Metadata } from "next";
import Certificate from "./Certificate";

export const metadata: Metadata = { title: "Trial certificate" };

export default function Page() {
  return <Certificate />;
}
