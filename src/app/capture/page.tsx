import type { Metadata } from "next";
import CaptureDemo from "./CaptureDemo";

export const metadata: Metadata = { title: "Camera check" };

export default function Page() {
  return <CaptureDemo />;
}
