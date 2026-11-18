import { Suspense } from "react";

import { DockBoard } from "./dock-board";

export default function DockPage() {
  return (
    <Suspense
      fallback={
        <p className="mx-auto max-w-[400px] bg-[#0E0F11] px-4 py-6 text-sm font-bold text-[#8B93A7]">불러오는 중</p>
      }
    >
      <DockBoard />
    </Suspense>
  );
}
