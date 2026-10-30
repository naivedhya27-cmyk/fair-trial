import type { Metadata } from "next";
import PhotoSession from "./PhotoSession";

export const metadata: Metadata = { title: "Today's photos" };

export default function Page() {
  return <PhotoSession />;
}
