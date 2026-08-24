import { HomeClient } from "@/components/HomeClient";

// `/` is the APP, and only the app. It used to be two pages behind one URL —
// the landing page for a stranger, the product for someone signed in — which
// was right while this deployment answered on resepta.xyz. It does not any
// more (2026-08-24): marketing is its own repo on its own project at the apex,
// and this one lives at app.resepta.xyz. A second copy of the pitch here would
// be a page nobody links to, drifting away from the one that is read.
//
// So there is no auth branch left in this file. A stranger never reaches it:
// `/` came off the public matcher in src/proxy.ts, and the redirect there
// sends them to /signin before any of this is built — the same rule that
// guards every other route in the app, rather than a second one written here.
export default function Home() {
  return <HomeClient />;
}
