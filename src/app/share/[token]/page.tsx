import { Suspense } from "react";

import { ShareBoard } from "./share-board";

export default function SharePage() {
  return (
    <Suspense
      fallback={
        <p className="mx-auto max-w-[430px] bg-[#0E0F11] px-4 py-6 text-sm font-bold text-[#8B93A7]">불러오는 중</p>
      }
    >
      <ShareBoard />
    </Suspense>
  );
}
