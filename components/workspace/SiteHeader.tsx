import Link from "next/link";
import { SignOutButton } from "@/components/auth/SignOutButton";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 h-14 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-full max-w-6xl items-center justify-between px-gutter">
        <Link href="/" className="text-sm font-semibold tracking-wide text-primary">
          Pathways
        </Link>
        <SignOutButton />
      </div>
    </header>
  );
}
