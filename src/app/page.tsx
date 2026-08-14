import { isAuthenticatedNextjs } from "@convex-dev/auth/nextjs/server";
import { HomeClient } from "@/components/HomeClient";

// `/` is two pages behind one URL: the landing page for a stranger and the
// app for someone signed in. The server check is passed into the client switch
// as its first render so signed-out HTML contains the actual landing page.
// Search engines and link readers should not have to execute auth JavaScript
// before they can read what Resepta is.
export default async function Home() {
  const initiallyAuthenticated = await isAuthenticatedNextjs();
  return <HomeClient initiallyAuthenticated={initiallyAuthenticated} />;
}
