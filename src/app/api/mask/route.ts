// Pass a mask image from YouCam's storage to the browser (which measures it per half-face); only YouCam's own storage
// hosts are fetched, only PNGs are passed on, and nothing is kept.
import { connection } from "next/server";
import { fetchMask, maskHostAllowed } from "@/lib/youcam/server";

export const maxDuration = 30;

const refuse = () => new Response("that address is not a YouCam mask", { status: 400 });

export async function GET(req: Request) {
  await connection();
  const u = new URL(req.url).searchParams.get("u");
  if (!u) return new Response("no mask address", { status: 400 });
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return refuse();
  }
  if (!maskHostAllowed(url)) return refuse();
  try {
    const bytes = await fetchMask(url.href);
    return new Response(bytes as BodyInit, {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=600", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return new Response("mask not available", { status: 502 });
  }
}
