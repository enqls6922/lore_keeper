import type { ReactNode } from "react";

import { DashboardLayout } from "@/components/DashboardLayout";

export default function StudioLayout({ children }: { children: ReactNode }) {
  return <DashboardLayout>{children}</DashboardLayout>;
}
