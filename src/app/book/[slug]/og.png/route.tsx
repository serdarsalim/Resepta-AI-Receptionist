import type { NextRequest } from "next/server";
import { apptPreview } from "@/lib/linkPreview";
import { bookModel, loadBrand } from "@/lib/linkPreviewServer";
import { cardCacheControl, renderCard } from "@/lib/linkPreviewCard";

// /book/<slug>/og.png: the picture under a pasted Resepta link (P27,
// lib/linkPreview). Plain, it is the booking page's card: the business, what
// it offers, where it is. `for=appt` is the manage page's card: the business
// and "Your appointment", nothing about whose; it lives under the slug so the
// manage token never rides an image address. `v` is the version stamp the
// page's tags put on it, which is what lets it be cached long.
//
// Public through src/proxy.ts's /book/(.*) and safe there: it reads only
// booking.brand, which publishes what the booking page already does. A
// switched-off booking page has no booking card (404), the same as it has no
// page; its manage card still draws, because a customer's own appointment
// link outlives the switch.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = await loadBrand(slug);
  if (!brand) return new Response("Not found", { status: 404 });
  const model = req.nextUrl.searchParams.get("for") === "appt" ? apptPreview(brand) : bookModel(brand);
  if (!model) return new Response("Not found", { status: 404 });
  return renderCard(model, cardCacheControl(req.nextUrl.searchParams.has("v")));
}
