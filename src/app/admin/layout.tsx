import { AdminShell } from "./shell";

// The console's frame; everything about it lives in ./shell.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
